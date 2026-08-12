import { describe, expect, it } from "vitest";
import {
  b64url,
  b64urlToBytes,
  encryptPayload,
  vapidAuthorization,
} from "../server/services/push";
import {
  MUTABLE_NOTIFICATION_TYPES,
  notificationPrefSchema,
  pushSubscribeSchema,
} from "../server/api/validators";

/*
 * The push crypto is the riskiest code in the feature — get a byte wrong and
 * the push service silently rejects every message — so these tests prove it
 * against the actual standards rather than a mock. The encryption test plays
 * the browser: it decrypts what the server produced and checks it comes back
 * whole. The VAPID test verifies the signature the way a push service would.
 *
 * Everything here runs on the same Web Crypto the Worker uses, so a pass means
 * the real send path is sound, not that a stand-in agrees with itself.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("base64url", () => {
  it("round-trips bytes including lengths that need every pad case", () => {
    for (let length = 0; length < 20; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) % 256);
      expect([...b64urlToBytes(b64url(bytes))]).toEqual([...bytes]);
    }
  });

  it("emits no +, / or = so the value is URL and header safe", () => {
    const bytes = new Uint8Array(96).map((_, i) => i * 5);
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
  });
});

describe("RFC 8291 payload encryption", () => {
  it("produces a body the subscribed browser can decrypt back to the original", async () => {
    // Stand in for the browser: its own ECDH key pair and auth secret are what a
    // real PushManager subscription would carry.
    const ua = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const authSecret = crypto.getRandomValues(new Uint8Array(16));

    const subscription = {
      p256dh: b64url(uaPublic),
      auth: b64url(authSecret),
    };

    const message = JSON.stringify({
      title: "graham",
      body: "commented on your post: nice rust",
      url: "/posts/p_123",
    });

    const body = await encryptPayload(subscription, encoder.encode(message));
    const decrypted = await decryptAsBrowser(body, ua.privateKey, uaPublic, authSecret);

    expect(decoder.decode(decrypted)).toBe(message);
  });

  it("uses a fresh salt and ephemeral key each time, so two sends differ", async () => {
    const ua = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const subscription = {
      p256dh: b64url(uaPublic),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const plaintext = encoder.encode("same message");

    const first = await encryptPayload(subscription, plaintext);
    const second = await encryptPayload(subscription, plaintext);

    // Salt is the first 16 bytes of the header; it must not repeat.
    expect([...first.slice(0, 16)]).not.toEqual([...second.slice(0, 16)]);
  });
});

describe("RFC 8292 VAPID", () => {
  it("signs a JWT a push service can verify, with the right audience and subject", async () => {
    const keys = await generateVapidKeys();
    const env = {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: "mailto:safety@spruetube.app",
    } as unknown as Env;

    const header = await vapidAuthorization(
      env,
      "https://fcm.googleapis.com/fcm/send/abc123",
    );

    const match = /^vapid t=([^,]+),k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(keys.publicKey);

    const [headerB64, payloadB64, signatureB64] = jwt!.split(".");
    const claims = JSON.parse(decoder.decode(b64urlToBytes(payloadB64!)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:safety@spruetube.app");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Verify the ES256 signature over "header.payload" with the public key —
    // exactly the check the push service runs before trusting the request.
    const verifyKey = await importVerifyKey(keys.publicKey);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      b64urlToBytes(signatureB64!),
      encoder.encode(`${headerB64}.${payloadB64}`),
    );
    expect(ok).toBe(true);
  });
});

describe("preference validators", () => {
  it("accepts a well-formed browser subscription", () => {
    const result = pushSubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "BPabc", auth: "xyz" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a subscription missing its keys", () => {
    const result = pushSubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    expect(result.success).toBe(false);
  });

  it("will not let a person mute system notifications", () => {
    expect(MUTABLE_NOTIFICATION_TYPES).not.toContain("system");
    const result = notificationPrefSchema.safeParse({ mutedTypes: ["system"] });
    expect(result.success).toBe(false);
  });

  it("accepts muting an ordinary type and a valid digest cadence", () => {
    const result = notificationPrefSchema.safeParse({
      mutedTypes: ["like", "follow"],
      emailDigest: "weekly",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown digest cadence", () => {
    const result = notificationPrefSchema.safeParse({ emailDigest: "hourly" });
    expect(result.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Test helpers: the browser's side of the two protocols                      */
/* -------------------------------------------------------------------------- */

/** Decrypt an aes128gcm body the way a subscribed browser would (RFC 8188). */
async function decryptAsBrowser(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256),
  );

  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    Uint8Array.of(0),
    uaPublic,
    asPublic,
  );
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext),
  );

  // Strip the RFC 8188 padding delimiter (0x02 on the last record).
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end--;
  return record.slice(0, end - 1);
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
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

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(publicRaw), privateKey: jwk.d! };
}

async function importVerifyKey(publicKey: string): Promise<CryptoKey> {
  const point = b64urlToBytes(publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64url(point.slice(1, 33)),
      y: b64url(point.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}
