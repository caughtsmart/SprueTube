import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseMatch,
  isShopConfigured,
  normalise,
  paintCacheKey,
  resolvePaint,
  resolvePaints,
  titleMatches,
  type ShopProduct,
} from "../server/services/paints";

/*
 * Two things matter most here and both are provable without a live shop:
 *
 *   1. The match is conservative — a wrong product link under a photo is worse
 *      than no link, so a loose or generic title must be rejected.
 *   2. The whole thing degrades to nothing. With the storefront unconfigured,
 *      resolution returns null and makes no network call, so a post that names
 *      paints still succeeds and stores plain names — the behaviour today.
 *
 * The Storefront fetch and the KV cache are side effects exercised by the guard
 * and match tests below; the GraphQL wire format is Shopify's to keep stable.
 */

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    SHOP_STOREFRONT_DOMAIN: "www.loadeddice.uk",
    SHOP_STOREFRONT_TOKEN: "storefront-token",
    ...overrides,
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalise", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalise("  Mephiston   Red! ")).toBe("mephiston red");
  });

  it("folds accents so 'Vallejo Prúsian' keys the same as the plain form", () => {
    expect(normalise("Prúsian")).toBe(normalise("Prusian"));
  });
});

describe("paintCacheKey", () => {
  it("is stable across spacing and case", () => {
    expect(paintCacheKey({ name: "Mephiston Red" })).toBe(
      paintCacheKey({ name: "  mephiston   RED " }),
    );
  });

  it("folds a brand duplicated at the front of the name", () => {
    // "Citadel Mephiston Red" (brand Citadel) should hit the same key as the
    // plain "Mephiston Red", so the cache is not fragmented by how it was typed.
    expect(
      paintCacheKey({ name: "Citadel Mephiston Red", brand: "Citadel" }),
    ).toBe(paintCacheKey({ name: "Mephiston Red", brand: "Citadel" }));
  });

  it("namespaces the key so a logic change can invalidate it", () => {
    expect(paintCacheKey({ name: "Mephiston Red" })).toMatch(/^paint:v1:/);
  });
});

describe("titleMatches — deliberately conservative", () => {
  it("matches the exact name", () => {
    expect(titleMatches("Mephiston Red", "Mephiston Red")).toBe(true);
  });

  it("matches through the shop's range and size descriptors", () => {
    expect(titleMatches("Mephiston Red", "Mephiston Red - Base (12ml)")).toBe(true);
  });

  it("rejects a different paint in the same range", () => {
    expect(titleMatches("Mephiston Red", "Khorne Red")).toBe(false);
  });

  it("rejects a query too generic to be safe", () => {
    expect(titleMatches("red", "Mephiston Red")).toBe(false);
  });
});

describe("chooseMatch", () => {
  const products: ShopProduct[] = [
    { handle: "khorne-red", title: "Khorne Red - Base (12ml)" },
    { handle: "mephiston-red", title: "Mephiston Red - Base (12ml)" },
  ];

  it("picks the confident match, not the first row", () => {
    expect(chooseMatch("Mephiston Red", products)?.handle).toBe("mephiston-red");
  });

  it("returns null when nothing matches", () => {
    expect(chooseMatch("Nihilakh Oxide", products)).toBeNull();
  });

  it("prefers an exact title over a looser one", () => {
    const withExact: ShopProduct[] = [
      { handle: "loose", title: "Mephiston Red Contrast Set" },
      { handle: "exact", title: "Mephiston Red" },
    ];
    expect(chooseMatch("Mephiston Red", withExact)?.handle).toBe("exact");
  });
});

describe("isShopConfigured", () => {
  it("is false when either value is missing or a placeholder", () => {
    expect(isShopConfigured(envWith({ SHOP_STOREFRONT_TOKEN: "" } as Partial<Env>))).toBe(false);
    expect(
      isShopConfigured(
        envWith({ SHOP_STOREFRONT_DOMAIN: "REPLACE_WITH_domain" } as Partial<Env>),
      ),
    ).toBe(false);
  });

  it("is true when both are real values", () => {
    expect(isShopConfigured(envWith())).toBe(true);
  });
});

describe("degradation with no storefront", () => {
  it("resolvePaint returns null and makes no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const env = envWith({ SHOP_STOREFRONT_TOKEN: "" } as Partial<Env>);
    expect(await resolvePaint(env, { name: "Mephiston Red" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolvePaints preserves order and nulls non-paint entries", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const env = envWith({ SHOP_STOREFRONT_DOMAIN: "" } as Partial<Env>);
    const result = await resolvePaints(env, [
      { name: "Mephiston Red" },
      null,
      { name: "Nuln Oil" },
    ]);
    expect(result).toEqual([null, null, null]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
