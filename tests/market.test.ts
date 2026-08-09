import { describe, expect, it } from "vitest";
import {
  BUMP_INTERVAL_SECONDS,
  canBump,
  filtersToQuery,
  formatListingPrice,
  hoursUntilBump,
  listingSlug,
  MAX_PRICE_PENCE,
  parseListingFilters,
  parsePricePounds,
  penceToPoundsInput,
} from "../server/services/market";
import { decodeCursor, encodeCursor } from "../server/services/feed";

describe("price parsing", () => {
  it("reads a plain number as whole pounds", () => {
    expect(parsePricePounds("24")).toEqual({ ok: true, pence: 2400 });
  });

  it("reads pence after a decimal point", () => {
    expect(parsePricePounds("24.50")).toEqual({ ok: true, pence: 2450 });
    expect(parsePricePounds("24.5")).toEqual({ ok: true, pence: 2450 });
    expect(parsePricePounds("0.99")).toEqual({ ok: true, pence: 99 });
  });

  it("does not lose a penny to floating point", () => {
    // 47.99 * 100 is 4798.9999999999995. A price a penny out is the kind of
    // thing people notice and do not forgive.
    expect(parsePricePounds("47.99")).toEqual({ ok: true, pence: 4799 });
    expect(parsePricePounds("1.10")).toEqual({ ok: true, pence: 110 });
  });

  it("accepts a leading pound sign and thousands separators", () => {
    expect(parsePricePounds("£24.50")).toEqual({ ok: true, pence: 2450 });
    expect(parsePricePounds("£ 24")).toEqual({ ok: true, pence: 2400 });
    expect(parsePricePounds("1,250")).toEqual({ ok: true, pence: 125_000 });
  });

  it("trims whitespace", () => {
    expect(parsePricePounds("  12  ")).toEqual({ ok: true, pence: 1200 });
  });

  it("treats empty input as no price rather than zero", () => {
    // Null means "offers" on a sale listing and "no budget stated" on a wanted
    // post. It must never become £0.
    expect(parsePricePounds("")).toEqual({ ok: true, pence: null });
    expect(parsePricePounds("   ")).toEqual({ ok: true, pence: null });
    expect(parsePricePounds(null)).toEqual({ ok: true, pence: null });
    expect(parsePricePounds(undefined)).toEqual({ ok: true, pence: null });
  });

  it("keeps an explicit zero as free", () => {
    expect(parsePricePounds("0")).toEqual({ ok: true, pence: 0 });
  });

  it("rejects nonsense rather than guessing", () => {
    for (const input of [
      "free",
      "abc",
      "-5",
      "£",
      "1e3",
      "20.555",
      "12.",
      "1 2",
      "£$24",
    ]) {
      expect(parsePricePounds(input).ok, input).toBe(false);
    }
  });

  it("rejects a price nobody meant to type", () => {
    expect(parsePricePounds("500000").ok).toBe(false);
    expect(parsePricePounds("9".repeat(20)).ok).toBe(false);
    expect(parsePricePounds(String(MAX_PRICE_PENCE / 100))).toEqual({
      ok: true,
      pence: MAX_PRICE_PENCE,
    });
  });

  it("round-trips back into the form field", () => {
    for (const input of ["24", "24.50", "0.05", "1250"]) {
      const parsed = parsePricePounds(input);
      expect(parsed.ok).toBe(true);
      const reparsed = parsePricePounds(
        penceToPoundsInput(parsed.ok ? parsed.pence : null),
      );
      expect(reparsed).toEqual(parsed);
    }
  });

  it("shows an empty field for no price", () => {
    expect(penceToPoundsInput(null)).toBe("");
    expect(penceToPoundsInput(undefined)).toBe("");
    expect(penceToPoundsInput(2450)).toBe("24.50");
    expect(penceToPoundsInput(2400)).toBe("24");
  });
});

describe("price labels", () => {
  it("says offers rather than nothing on a sale with no price", () => {
    expect(formatListingPrice("sale", null)).toBe("Offers");
  });

  it("never renders a null as free", () => {
    expect(formatListingPrice("sale", null)).not.toMatch(/£|free/i);
    expect(formatListingPrice("wanted", null)).toBeNull();
  });

  it("does render an explicit zero as free", () => {
    expect(formatListingPrice("sale", 0)).toBe("Free");
  });

  it("words a wanted budget so it cannot be read as a sale price", () => {
    expect(formatListingPrice("sale", 4500)).toBe("£45");
    expect(formatListingPrice("wanted", 4500)).toBe("Paying up to £45");
  });
});

describe("listing slugs", () => {
  it("makes a readable slug from a title", () => {
    expect(listingSlug("Death Guard Plague Marines")).toBe(
      "death-guard-plague-marines",
    );
  });

  it("collapses punctuation and prices rather than leaving them in the URL", () => {
    expect(listingSlug("Leviathan box — £45 ono!")).toBe("leviathan-box-45-ono");
  });

  it("strips accents instead of percent-encoding them", () => {
    expect(listingSlug("Légion Impériale")).toBe("legion-imperiale");
  });

  it("never returns an empty slug", () => {
    // A title of only emoji is entirely plausible, and an empty slug would
    // collide with the seller's own market page one segment up.
    expect(listingSlug("🎨")).toBe("listing");
    expect(listingSlug("???")).toBe("listing");
  });

  it("caps the length and leaves no trailing dash", () => {
    const slug = listingSlug(`${"a".repeat(58)} boxed set`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("browse filters", () => {
  it("reads the three filters", () => {
    expect(
      parseListingFilters({
        kind: "wanted",
        system: "warhammer-40k",
        condition: "new_sprue",
      }),
    ).toEqual({
      kind: "wanted",
      gameSystem: "warhammer-40k",
      condition: "new_sprue",
    });
  });

  it("ignores values it does not recognise rather than erroring", () => {
    // These URLs get shared and hand-edited; a stale filter should widen the
    // list, not produce an error page.
    expect(
      parseListingFilters({ kind: "swap", condition: "mint", system: "  " }),
    ).toEqual({ kind: null, gameSystem: null, condition: null });
  });

  it("treats missing input as no filters", () => {
    expect(parseListingFilters({})).toEqual({
      kind: null,
      gameSystem: null,
      condition: null,
    });
  });

  it("round-trips through a query string", () => {
    const filters = parseListingFilters({
      kind: "sale",
      system: "kill-team",
      condition: "painted",
    });
    const query = filtersToQuery(filters);
    const params = new URLSearchParams(query);
    expect(
      parseListingFilters({
        kind: params.get("kind"),
        system: params.get("system"),
        condition: params.get("condition"),
      }),
    ).toEqual(filters);
  });

  it("writes nothing for an unfiltered board", () => {
    expect(filtersToQuery(parseListingFilters({}))).toBe("");
  });
});

describe("bumping", () => {
  const now = 1_800_000_000;

  it("refuses a second bump the same day", () => {
    expect(canBump(now - 3600, now)).toBe(false);
    expect(canBump(now, now)).toBe(false);
  });

  it("allows one a day later", () => {
    expect(canBump(now - BUMP_INTERVAL_SECONDS, now)).toBe(true);
    expect(canBump(now - BUMP_INTERVAL_SECONDS - 1, now)).toBe(true);
  });

  it("says how long is left, rounded up so it never reads as ready early", () => {
    expect(hoursUntilBump(now - 3600, now)).toBe(23);
    expect(hoursUntilBump(now - BUMP_INTERVAL_SECONDS + 1, now)).toBe(1);
    expect(hoursUntilBump(now - BUMP_INTERVAL_SECONDS, now)).toBe(0);
  });
});

describe("browse cursors", () => {
  it("pages on (bumpedAt, id) and survives the round trip", () => {
    // The market list is keyed on bumpedAt, which moves whenever anybody bumps
    // anything — which is exactly why it is a keyset cursor and not an OFFSET.
    const cursor = { score: 1_786_059_575, id: "lst_0msi5r8lx00hi24s82j" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("treats junk as no cursor rather than throwing", () => {
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});
