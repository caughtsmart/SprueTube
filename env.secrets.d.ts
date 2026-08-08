/*
 * Secrets, merged into the Env interface generated from wrangler.jsonc.
 * Set locally in .dev.vars, in production with `wrangler secret put <NAME>`.
 *
 * These are typed `string` rather than optional because `wrangler types` types
 * them that way whenever a .dev.vars file is present, and two declarations of
 * the same interface must agree. The social ones can genuinely be unset at
 * runtime, so the code checks them for truthiness rather than trusting the
 * type — see `createAuth` in server/auth.ts.
 */
declare interface Env {
  /** 32+ random bytes. Signs session cookies — rotating it logs everyone out. */
  BETTER_AUTH_SECRET: string;
  /** Cloudflare API token with Images:Edit. */
  CF_API_TOKEN: string;

  /** Unset ⇒ the Google button is hidden. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Services id for Sign in with Apple, required before iOS submission. */
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
}
