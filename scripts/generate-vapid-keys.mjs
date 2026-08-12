#!/usr/bin/env node
/*
 * Generate a VAPID key pair for Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Prints the pair in the base64url form the web-push ecosystem uses and the
 * server (server/services/push.ts) expects: the public key is the 65-byte
 * uncompressed P-256 point, the private key the 32-byte scalar.
 *
 * Local dev: paste the two into .dev.vars.
 * Production: `wrangler secret put VAPID_PUBLIC_KEY` and `… VAPID_PRIVATE_KEY`,
 * then set VAPID_SUBJECT to a mailto: you actually read.
 *
 * No dependencies — this is Node's own Web Crypto, the same primitives the
 * Worker signs with, so a key generated here is one the Worker can import.
 */

import { webcrypto as crypto } from "node:crypto";

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

// Public key as the raw uncompressed point (0x04 ‖ X ‖ Y), 65 bytes.
const publicRaw = new Uint8Array(
  await crypto.subtle.exportKey("raw", keyPair.publicKey),
);

// Private key: pull `d` straight out of the JWK, already base64url.
const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

console.log("VAPID_PUBLIC_KEY=" + JSON.stringify(b64url(publicRaw)));
console.log("VAPID_PRIVATE_KEY=" + JSON.stringify(jwk.d));
console.log('VAPID_SUBJECT="mailto:safety@spruetube.app"');
