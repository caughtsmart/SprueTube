/*
 * Photo uploads.
 *
 * Nothing large is ever proxied through this Worker. Cloudflare Images mints a
 * one-time upload URL that the browser posts the file to directly, so a 20 MB
 * photo never touches our request path and an upload that fails halfway costs
 * us nothing.
 *
 * Photos only, deliberately. Video meant Cloudflare Stream, a signed webhook, a
 * `processing` post state and a reconciliation sweep for webhooks that never
 * arrive — a lot of moving parts, and the cost grows with the library forever.
 * Miniature painting is a photo hobby; this can come back when it earns its way.
 */

import { isConfigured } from "../../app/lib/media";

const API_BASE = "https://api.cloudflare.com/client/v4";

export type ImageUploadTicket = {
  uploadUrl: string;
  imageId: string;
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
  if (!imageId || !isConfigured(env.CF_IMAGES_ACCOUNT_HASH)) return null;
  return `https://imagedelivery.net/${env.CF_IMAGES_ACCOUNT_HASH}/${imageId}/${variant}`;
}
