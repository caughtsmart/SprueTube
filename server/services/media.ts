/*
 * Media uploads.
 *
 * Nothing large is ever proxied through this Worker. Both Images and Stream can
 * mint a one-time upload URL that the browser (or the iOS app) posts the file
 * to directly. That keeps a 400 MB video off our request path, avoids the
 * Workers body-size limit entirely, and means an upload that fails halfway
 * costs us nothing.
 *
 * Flow for video:
 *   1. client asks for an upload URL      → createVideoUpload()
 *   2. client PUTs the file to Stream     → (no Worker involvement)
 *   3. Stream transcodes, then calls us   → /api/v1/webhooks/stream
 *   4. we flip the post from `processing` to `published`
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

export type ImageUploadTicket = {
  uploadUrl: string;
  imageId: string;
};

export type VideoUploadTicket = {
  uploadUrl: string;
  streamUid: string;
};

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
};

export class MediaError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

async function cfFetch<T>(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as CloudflareResponse<T>;
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((e) => e.message).join("; ");
    throw new MediaError(
      detail || `Cloudflare API returned ${response.status}`,
      payload.errors,
    );
  }
  return payload.result;
}

/**
 * One-time direct-creator-upload URL for an image.
 *
 * `requireSignedURLs: false` because everything here is public content behind a
 * public feed — signing would break the plain <img> tags that make the feed fast.
 */
export async function createImageUpload(
  env: Env,
  meta: { userId: string; purpose: "post" | "avatar" | "banner" | "cover" },
): Promise<ImageUploadTicket> {
  const form = new FormData();
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify(meta));
  // Unclaimed tickets expire rather than lingering as upload capacity.
  form.set("expiry", new Date(Date.now() + 30 * 60 * 1000).toISOString());

  const result = await cfFetch<{ id: string; uploadURL: string }>(
    env,
    "/images/v2/direct_upload",
    { method: "POST", body: form },
  );

  return { uploadUrl: result.uploadURL, imageId: result.id };
}

export async function deleteImage(env: Env, imageId: string): Promise<void> {
  await cfFetch(env, `/images/v1/${imageId}`, { method: "DELETE" });
}

/**
 * One-time upload URL for a video.
 *
 * maxDurationSeconds is the cost lever that matters: Stream bills by minutes
 * stored, so an unbounded upload is an unbounded bill. Ten minutes is generous
 * for a painting tutorial and still bounded.
 */
export async function createVideoUpload(
  env: Env,
  meta: { userId: string; postId: string },
  maxDurationSeconds = 600,
): Promise<VideoUploadTicket> {
  const result = await cfFetch<{ uid: string; uploadURL: string }>(
    env,
    "/stream/direct_upload",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maxDurationSeconds,
        expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        requireSignedURLs: false,
        meta,
        // Stream calls the webhook when this is ready; see webhooks/stream.
        allowedOrigins: [new URL(env.SITE_URL).host],
      }),
    },
  );

  return { uploadUrl: result.uploadURL, streamUid: result.uid };
}

export async function getVideo(env: Env, uid: string) {
  return cfFetch<{
    uid: string;
    readyToStream: boolean;
    status: { state: string; errorReasonText?: string };
    duration: number;
    thumbnail: string;
    input: { width: number; height: number };
  }>(env, `/stream/${uid}`, { method: "GET" });
}

export async function deleteVideo(env: Env, uid: string): Promise<void> {
  await cfFetch(env, `/stream/${uid}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* URL builders                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Named variants configured in the Images dashboard. Keep this list and the
 * dashboard in step — an unknown variant returns a 404, not a fallback.
 */
export type ImageVariant =
  | "thumbnail"
  | "avatar"
  | "feed"
  | "full"
  | "public";

export function imageUrl(
  env: Pick<Env, "CF_IMAGES_ACCOUNT_HASH">,
  imageId: string | null | undefined,
  variant: ImageVariant = "public",
): string | null {
  if (!imageId || !env.CF_IMAGES_ACCOUNT_HASH) return null;
  return `https://imagedelivery.net/${env.CF_IMAGES_ACCOUNT_HASH}/${imageId}/${variant}`;
}

export function videoPlaybackUrl(
  env: Pick<Env, "CF_STREAM_CUSTOMER_SUBDOMAIN">,
  streamUid: string | null | undefined,
): string | null {
  if (!streamUid || !env.CF_STREAM_CUSTOMER_SUBDOMAIN) return null;
  return `https://${env.CF_STREAM_CUSTOMER_SUBDOMAIN}/${streamUid}/manifest/video.m3u8`;
}

export function videoIframeUrl(
  env: Pick<Env, "CF_STREAM_CUSTOMER_SUBDOMAIN">,
  streamUid: string | null | undefined,
): string | null {
  if (!streamUid || !env.CF_STREAM_CUSTOMER_SUBDOMAIN) return null;
  return `https://${env.CF_STREAM_CUSTOMER_SUBDOMAIN}/${streamUid}/iframe`;
}

export function videoThumbnailUrl(
  env: Pick<Env, "CF_STREAM_CUSTOMER_SUBDOMAIN">,
  streamUid: string | null | undefined,
  atSecond = 1,
): string | null {
  if (!streamUid || !env.CF_STREAM_CUSTOMER_SUBDOMAIN) return null;
  return `https://${env.CF_STREAM_CUSTOMER_SUBDOMAIN}/${streamUid}/thumbnails/thumbnail.jpg?time=${atSecond}s`;
}

/* -------------------------------------------------------------------------- */
/* Webhook verification                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Stream signs webhooks with `Webhook-Signature: time=<ts>,sig1=<hex>` over
 * "<ts>.<body>". Verified with a constant-time compare so the check cannot be
 * probed a byte at a time, and with a freshness window so a captured callback
 * cannot be replayed later.
 */
export async function verifyStreamWebhook(
  secret: string,
  signatureHeader: string | null,
  rawBody: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((piece) => {
      const [k, v] = piece.split("=");
      return [k?.trim() ?? "", v?.trim() ?? ""];
    }),
  );
  const timestamp = parts.time;
  const provided = parts.sig1;
  if (!timestamp || !provided) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, provided);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
