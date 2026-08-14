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

  /*
   * Web Push (VAPID). All three unset ⇒ push is disabled and every send is a
   * no-op, the same way the mailer is without its binding. Generate a pair with
   * `node scripts/generate-vapid-keys.mjs`.
   *
   * PUBLIC_KEY is genuinely public — it is shipped to every browser so it can
   * subscribe — but it lives here rather than in wrangler.jsonc so the three
   * move together and an environment with no keys stays a clean no-op.
   */
  /** base64url of the 65-byte uncompressed P-256 point. Sent to browsers. */
  VAPID_PUBLIC_KEY: string;
  /** base64url of the 32-byte private scalar. Signs push requests — a secret. */
  VAPID_PRIVATE_KEY: string;
  /** Contact for the push service, e.g. "mailto:safety@spruetube.app". */
  VAPID_SUBJECT: string;

  /*
   * Paint resolution against the Loaded Dice storefront (roadmap item 3). Both
   * unset ⇒ paint names never resolve to a shop link and render as plain text,
   * exactly the behaviour before this existed. The domain is public config and
   * the token is a read-only Storefront API access token; they live here
   * together so an environment with neither stays a clean no-op.
   */
  /** Storefront host, e.g. "www.loadeddice.uk". Unset ⇒ resolution is a no-op. */
  SHOP_STOREFRONT_DOMAIN: string;
  /** Shopify Storefront API access token (read-only). */
  SHOP_STOREFRONT_TOKEN: string;

  /*
   * Launch curtain (workers/comingSoon.ts). COMING_SOON is public config and
   * lives in wrangler.jsonc, but can be overridden by a secret of the same name
   * to flip the curtain without a redeploy. The bypass token is the credential.
   */
  /** Preview token. ?preview=<token> unlocks the curtain. Unset ⇒ no bypass. */
  COMING_SOON_BYPASS: string;
}
