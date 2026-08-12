/*
 * Paint resolution — the quiet commercial layer's engine.
 *
 * Turns a paint name written under a photo ("Mephiston Red") into a Loaded Dice
 * product link, so the "paints used" strip earns its keep without the post ever
 * looking like an advert. This is roadmap item 3 ("paint links that resolve"):
 * `post_product.shop_url` has always existed but was never filled.
 *
 * Three things keep it safe to run on every post:
 *
 *   1. It degrades to nothing. With SHOP_STOREFRONT_* unset it is a no-op that
 *      returns null and makes no request, exactly as `imageUrl` returns null
 *      without CF_IMAGES_ACCOUNT_HASH. A paint just renders as its name — the
 *      behaviour today — so local dev and any un-provisioned environment work.
 *   2. It never throws into the caller. A failed lookup returns null and is
 *      logged once; a post must never fail because the shop was slow.
 *   3. It caches hits *and* misses in KV. The same paint names recur constantly
 *      and most custom mixes will never match, so an unknown paint is cached as
 *      a miss and not re-queried on every post.
 *
 * Resolution runs against the Loaded Dice storefront via the Shopify Storefront
 * API — a public, read-only GraphQL endpoint, so the token is low-risk.
 */

import { isConfigured } from "../../app/lib/media";

const API_VERSION = "2024-01";
const CACHE_PREFIX = "paint:v1:";
/** Seconds. The catalogue changes slowly, so a hit can live a week. */
const HIT_TTL = 7 * 24 * 60 * 60;
/** A miss lives a day, so a paint added to the shop later resolves without a week's wait. */
const MISS_TTL = 24 * 60 * 60;
/** Stored for "looked, found nothing", so an unknown paint is not re-queried. */
const MISS = "";

export type PaintQuery = { name: string; brand?: string | null };
export type ShopProduct = { handle: string; title: string; url?: string | null };

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** True only when the storefront is actually reachable — not a placeholder. */
export function isShopConfigured(env: Env): boolean {
  return (
    isConfigured(env.SHOP_STOREFRONT_DOMAIN) &&
    isConfigured(env.SHOP_STOREFRONT_TOKEN)
  );
}

/** Resolve one paint name to a Loaded Dice product URL, or null if unmatched. */
export async function resolvePaint(
  env: Env,
  input: PaintQuery,
): Promise<string | null> {
  if (!isShopConfigured(env)) return null;

  const key = paintCacheKey(input);
  const cached = await readCache(env, key);
  if (cached !== undefined) return cached === MISS ? null : cached;

  let url: string | null;
  try {
    const products = await storefrontProducts(env, input.name);
    const match = chooseMatch(input.name, products);
    url = match
      ? (match.url ?? `https://${shopHost(env)}/products/${match.handle}`)
      : null;
  } catch (error) {
    // Transient: do not cache the failure, degrade to plain text, retry next time.
    console.error("paints: resolve failed", error);
    return null;
  }

  await writeCache(env, key, url ?? MISS, url ? HIT_TTL : MISS_TTL);
  return url;
}

/**
 * Resolve many at once, order-preserving. Each entry is independent and
 * failure-isolated, and a null entry (e.g. a kit, not a paint) resolves to null
 * without a lookup.
 */
export async function resolvePaints(
  env: Env,
  inputs: (PaintQuery | null)[],
): Promise<(string | null)[]> {
  return Promise.all(
    inputs.map((input) => (input ? resolvePaint(env, input) : Promise.resolve(null))),
  );
}

/* -------------------------------------------------------------------------- */
/* Pure helpers (unit-tested)                                                 */
/* -------------------------------------------------------------------------- */

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalise(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A cache key that treats "Mephiston Red" and "  mephiston  red " alike, and
 * folds a brand duplicated at the front of the name ("Citadel Mephiston Red"
 * with brand "Citadel") so it does not miss the cache against "Mephiston Red".
 */
export function paintCacheKey(input: PaintQuery): string {
  const brand = input.brand ? normalise(input.brand) : "";
  let name = normalise(input.name);
  if (brand && name.startsWith(`${brand} `)) name = name.slice(brand.length + 1);
  return `${CACHE_PREFIX}${brand.replace(/ /g, "-")}:${name.replace(/ /g, "-")}`;
}

/**
 * Whether a shop product title is a confident match for a paint name.
 *
 * Deliberately conservative: a wrong link in the "paints used" strip is worse
 * than no link, so a generic or loosely-related title is rejected. A title's
 * bracketed size and its range descriptor ("- Base", "12ml") are stripped
 * before comparison, because the shop lists "Mephiston Red - Base (12ml)" and
 * the painter wrote "Mephiston Red".
 */
export function titleMatches(query: string, title: string): boolean {
  const q = normalise(query);
  // Too short to be safe — "red" would match half the catalogue.
  if (q.length < 4) return false;
  const full = normalise(title);
  const core = normalise(
    title
      .replace(/\(.*?\)/g, " ")
      .replace(/\b(base|layer|shade|contrast|technique|air|spray|dry|paint|acrylic|\d+\s?ml)\b/gi, " "),
  );
  return full === q || core === q;
}

/**
 * The best confident match among the shop's results, preferring an exact
 * normalised title, else the first title that passes `titleMatches`, else null.
 */
export function chooseMatch(
  query: string,
  products: ShopProduct[],
): ShopProduct | null {
  const q = normalise(query);
  let fallback: ShopProduct | null = null;
  for (const product of products) {
    if (normalise(product.title) === q) return product;
    if (!fallback && titleMatches(query, product.title)) fallback = product;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Storefront + cache (side-effecting)                                        */
/* -------------------------------------------------------------------------- */

function shopHost(env: Env): string {
  return env.SHOP_STOREFRONT_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function storefrontProducts(
  env: Env,
  query: string,
): Promise<ShopProduct[]> {
  const response = await fetch(
    `https://${shopHost(env)}/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Storefront-Access-Token": env.SHOP_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({
        query:
          "query($q:String!){products(first:6,query:$q){edges{node{handle title onlineStoreUrl}}}}",
        variables: { q: query },
      }),
    },
  );
  if (!response.ok) throw new Error(`storefront returned ${response.status}`);

  const json = (await response.json()) as {
    data?: {
      products?: {
        edges?: { node: { handle: string; title: string; onlineStoreUrl?: string | null } }[];
      };
    };
  };
  return (json.data?.products?.edges ?? []).map((edge) => ({
    handle: edge.node.handle,
    title: edge.node.title,
    url: edge.node.onlineStoreUrl ?? null,
  }));
}

async function readCache(env: Env, key: string): Promise<string | undefined> {
  try {
    const value = await env.CACHE.get(key);
    return value === null ? undefined : value;
  } catch {
    // A cache read failing is not a resolution failing — fall through to a live
    // lookup rather than treating it as a miss we then cache.
    return undefined;
  }
}

async function writeCache(
  env: Env,
  key: string,
  value: string,
  ttl: number,
): Promise<void> {
  try {
    await env.CACHE.put(key, value, { expirationTtl: ttl });
  } catch {
    // Best-effort: a resolved link that fails to cache is still returned.
  }
}
