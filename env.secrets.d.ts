/*
 * Secrets, merged into the Env interface generated from wrangler.jsonc.
 * Set locally in .dev.vars, in production with `wrangler secret put <NAME>`.
 */
declare interface Env {
  /** 32+ random bytes. Signs session cookies — rotating it logs everyone out. */
  BETTER_AUTH_SECRET: string;
  /** Cloudflare API token with Images:Edit and Stream:Edit. */
  CF_API_TOKEN: string;
  /** Shared secret from the Stream webhook settings, verifies ready callbacks. */
  CF_STREAM_WEBHOOK_SECRET?: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Services id for Sign in with Apple, required before iOS submission. */
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
}
