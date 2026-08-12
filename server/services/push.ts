/*
 * Web Push.
 *
 * Sends a push message to a browser's push service (the endpoint the browser
 * hands us at subscribe time) so a person hears about an interaction without
 * the tab open. No vendor and no app: the whole thing runs on Web Crypto in the
 * Worker, and the only new secret is a VAPID key pair.
 *
 * Two standards do the work, both implemented here with the platform's own
 * crypto rather than a dependency:
 *
 *   - RFC 8292 (VAPID) — a signed JWT that identifies us to the push service,
 *     so it will accept the request and can contact us if we misbehave.
 *   - RFC 8291 + RFC 8188 (aes128gcm) — the payload is encrypted to the
 *     subscription's public key, so the push service relays ciphertext it
 *     cannot read.
 *
 * The fan-out entry point is `pushToUser`, called from `createNotification`
 * (server/services/posts.ts) on `ctx.waitUntil` so a like never waits on a
 * push and a failed push never fails the like. With no VAPID keys configured it
 * is a no-op with one log line, exactly like the transactional mailer without
 * its binding — local dev needs no setup.
 */

import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../db/client";
import { notificationPref, profile, pushSubscription } from "../db/schema";
import type { PushSubscription } from "../db/schema";

/** A subscription drops after this many consecutive failed sends. */
const MAX_FAILURES = 5;

/** How the push service should hold the message if the device is offline. */
const TTL_SECONDS = 24 * 60 * 60;

export type NotificationType =
  | "recipe_saved"
  | "recipe_forked"
  | "like"
  | "comment"
  | "reply"
  | "follow"
  | "mention"
  | "system"
  | "message"
  | "listing_reply";

export type PushNotificationInput = {
  userId: string;
  actorId?: string | null;
  type: NotificationType;
  subjectType?:
    | "post"
    | "comment"
    | "user"
    | "project"
    | "listing"
    | "message"
    | "recipe"
    | null;
  subjectId?: string | null;
  preview?: string | null;
};

/*
 * What a route hands to createNotification so the notification can also be
 * pushed. `waitUntil` keeps the send off the request's critical path; `env`
 * carries the VAPID keys and the D1 binding. Absent ⇒ in-app only, which is the
 * default for every caller that does not opt in.
 */
export type PushDelivery = {
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
};

/* -------------------------------------------------------------------------- */
/* Fan-out                                                                    */
/* -------------------------------------------------------------------------- */

let warnedNoKeys = false;

function hasVapidKeys(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/**
 * Push one notification to every device a person has subscribed, honouring
 * their preferences. Best-effort throughout: a bad subscription is pruned, a
 * transient failure is counted, and nothing here rejects into the caller.
 */
export async function pushToUser(
  env: Env,
  input: PushNotificationInput,
): Promise<void> {
  if (!hasVapidKeys(env)) {
    if (!warnedNoKeys) {
      warnedNoKeys = true;
      console.warn("push: VAPID keys not configured, Web Push disabled");
    }
    return;
  }

  const db = createDb(env.DB);

  const pref = await db.query.notificationPref.findFirst({
    where: eq(notificationPref.userId, input.userId),
  });
  if (!pref?.pushEnabled) return;
  if ((pref.mutedTypes ?? []).includes(input.type)) return;

  const subs = await db
    .select()
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, input.userId));
  if (!subs.length) return;

  // One lookup gives the notification a title, and an avatar for the icon.
  const actor = input.actorId
    ? await db.query.profile.findFirst({
        where: eq(profile.userId, input.actorId),
        columns: { username: true, displayName: true, avatarImageId: true },
      })
    : null;

  const payload = buildPayload(env, input, actor ?? null);

  await Promise.all(subs.map((sub) => deliverOne(env, db, sub, payload)));
}

const VERB: Record<NotificationType, string> = {
  like: "liked your post",
  comment: "commented on your post",
  reply: "replied to you",
  follow: "started following you",
  mention: "mentioned you",
  message: "sent you a message",
  listing_reply: "replied about your listing",
  recipe_saved: "saved your recipe",
  recipe_forked: "adapted your recipe",
  system: "",
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  icon?: string;
};

/**
 * The tapped-notification destination, mirroring the in-app list's own linking
 * (app/routes/notifications.tsx) so a push lands exactly where the row would.
 * Anything without a specific target goes to the notifications page rather than
 * the feed — it is at least an answer to "what was that about".
 */
function targetUrl(input: PushNotificationInput, actorUsername?: string | null): string {
  if (input.type === "follow" && actorUsername) return `/@${actorUsername}`;
  if (input.subjectType === "message" && input.subjectId) {
    return `/messages/${input.subjectId}`;
  }
  if (input.subjectType === "post" && input.subjectId) {
    return `/posts/${input.subjectId}`;
  }
  return "/notifications";
}

function buildPayload(
  env: Env,
  input: PushNotificationInput,
  actor: { username: string; displayName: string; avatarImageId: string | null } | null,
): PushPayload {
  const verb = VERB[input.type];
  const body = input.preview
    ? verb
      ? `${verb}: ${input.preview}`
      : input.preview
    : verb || "You have a new notification";

  const icon =
    actor?.avatarImageId && env.CF_IMAGES_ACCOUNT_HASH
      ? `https://imagedelivery.net/${env.CF_IMAGES_ACCOUNT_HASH}/${actor.avatarImageId}/avatar`
      : undefined;

  return {
    title: actor?.displayName || env.SITE_NAME || "SprueTube",
    body,
    url: targetUrl(input, actor?.username),
    icon,
  };
}

async function deliverOne(
  env: Env,
  db: Db,
  sub: PushSubscription,
  payload: PushPayload,
): Promise<void> {
  let status: number;
  try {
    status = await sendWebPush(env, sub, payload);
  } catch (error) {
    console.error("push: send threw", error);
    await bumpFailure(db, sub);
    return;
  }

  if (status === 200 || status === 201) {
    await db
      .update(pushSubscription)
      .set({ lastSuccessAt: Math.floor(Date.now() / 1000), failureCount: 0 })
      .where(eq(pushSubscription.id, sub.id));
    return;
  }

  // 404/410 is the ordinary way a subscription dies — the browser unsubscribed
  // or the push service expired it. Delete the row; it is not an error to retry.
  if (status === 404 || status === 410) {
    await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
    return;
  }

  // 429, 5xx and anything else: transient. Count it, and prune once a
  // subscription has failed enough times to look permanently gone.
  console.warn(`push: endpoint returned ${status}`);
  await bumpFailure(db, sub);
}

async function bumpFailure(db: Db, sub: PushSubscription): Promise<void> {
  if (sub.failureCount + 1 >= MAX_FAILURES) {
    await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
    return;
  }
  await db
    .update(pushSubscription)
    .set({ failureCount: sql`${pushSubscription.failureCount} + 1` })
    .where(eq(pushSubscription.id, sub.id));
}

/* -------------------------------------------------------------------------- */
/* One send: VAPID auth + encrypted body                                      */
/* -------------------------------------------------------------------------- */

/**
 * Send one encrypted push. Returns the HTTP status so the caller can decide
 * whether to keep, prune or count the subscription. Throws only on a transport
 * failure (the `fetch` itself rejecting), which the caller treats as transient.
 */
export async function sendWebPush(
  env: Env,
  sub: Pick<PushSubscription, "endpoint" | "p256dh" | "auth">,
  payload: PushPayload,
): Promise<number> {
  const body = await encryptPayload(sub, utf8(JSON.stringify(payload)));
  const authorization = await vapidAuthorization(env, sub.endpoint);

  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/octet-stream",
      "content-encoding": "aes128gcm",
      ttl: String(TTL_SECONDS),
      urgency: "normal",
    },
    body,
  });

  return response.status;
}

/* -------------------------------------------------------------------------- */
/* RFC 8292 — VAPID                                                           */
/* -------------------------------------------------------------------------- */

export async function vapidAuthorization(env: Env, endpoint: string): Promise<string> {
  const audience = new URL(endpoint);
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: `${audience.protocol}//${audience.host}`,
    // 12 hours. Push services reject anything more than 24h out.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT,
  };

  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(
    utf8(JSON.stringify(claims)),
  )}`;

  const key = await importVapidSigningKey(env);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  );

  const jwt = `${signingInput}.${b64url(signature)}`;
  return `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`;
}

/*
 * The VAPID keys are stored the way the web-push ecosystem stores them:
 * `VAPID_PUBLIC_KEY` is base64url of the 65-byte uncompressed P-256 point,
 * `VAPID_PRIVATE_KEY` base64url of the 32-byte private scalar. Web Crypto wants
 * a JWK, so the point is split back into its x and y halves and the scalar
 * dropped in as `d`.
 */
async function importVapidSigningKey(env: Env): Promise<CryptoKey> {
  const point = b64urlToBytes(env.VAPID_PUBLIC_KEY);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64url(point.slice(1, 33)),
    y: b64url(point.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/* -------------------------------------------------------------------------- */
/* RFC 8291 / RFC 8188 — aes128gcm payload encryption                        */
/* -------------------------------------------------------------------------- */

export async function encryptPayload(
  sub: Pick<PushSubscription, "p256dh" | "auth">,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(sub.p256dh); // client public key, 65 bytes
  const authSecret = b64urlToBytes(sub.auth); // client auth secret, 16 bytes

  // Our own ephemeral key for this one message.
  const asKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", asKeys.publicKey),
  );

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 §3.4: fold the auth secret and the ECDH secret into the input
  // keying material with a context that binds both public keys.
  const keyInfo = concat(
    utf8("WebPush: info"),
    Uint8Array.of(0),
    uaPublic,
    asPublic,
  );
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188 §2.2: derive the content-encryption key and nonce from the salt.
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // Single record, so the padding delimiter is 0x02 ("last record").
  const record = concat(plaintext, Uint8Array.of(2));
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, record),
  );

  // RFC 8188 §2.1 header: salt(16) | record_size(4) | idlen(1) | keyid(as_public).
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return concat(header, ciphertext);
}

/** Full HKDF (extract then expand) with SHA-256, returning `length` bytes. */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/* -------------------------------------------------------------------------- */
/* Bytes and base64url                                                        */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();
function utf8(value: string): Uint8Array<ArrayBuffer> {
  // TextEncoder is ArrayBuffer-backed at runtime; the cast only narrows the
  // generic the DOM lib widened to ArrayBufferLike, which Web Crypto rejects.
  return encoder.encode(value) as Uint8Array<ArrayBuffer>;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const withPad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
