import { describe, expect, it } from "vitest";
import {
  decodeBrowseCursor,
  encodeBrowseCursor,
  parsePounds,
  priceRangeError,
  validateCommission,
} from "../server/services/commissions";
import {
  isUnreadFor,
  messagePreview,
  orderPair,
  otherUserId,
  sideOf,
  validateMessageBody,
} from "../server/services/messaging";

/* -------------------------------------------------------------------------- */
/* The pair                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * orderPair gets the most attention in this file on purpose. If it ever returns
 * a different answer depending on which participant happens to be the caller,
 * the same two people get two conversation rows holding half a conversation
 * each, and no later code can tell that has happened.
 */
describe("orderPair", () => {
  it("gives the same pair whichever way round the two ids arrive", () => {
    const forwards = orderPair("u_alice", "u_bob");
    const backwards = orderPair("u_bob", "u_alice");
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual({ lowUserId: "u_alice", highUserId: "u_bob" });
  });

  it("always puts the string-smaller id in lowUserId", () => {
    const pairs: [string, string][] = [
      ["a", "b"],
      ["b", "a"],
      ["u_1", "u_10"],
      ["u_10", "u_1"],
      ["u_2", "u_10"],
      ["Zeta", "alpha"],
      ["alpha", "Zeta"],
      ["u_9zzz", "u_a000"],
    ];

    for (const [a, b] of pairs) {
      const pair = orderPair(a, b);
      expect(pair.lowUserId < pair.highUserId).toBe(true);
      expect(new Set([pair.lowUserId, pair.highUserId])).toEqual(new Set([a, b]));
    }
  });

  it("sorts by code unit, not by locale — uppercase comes first", () => {
    // localeCompare would put "alpha" before "Zeta" on most locales and after
    // it on some. Plain `<` is the same everywhere, which is the whole point.
    expect(orderPair("Zeta", "alpha")).toEqual({
      lowUserId: "Zeta",
      highUserId: "alpha",
    });
  });

  it("treats a shorter id as smaller when it is a prefix of the other", () => {
    expect(orderPair("u_10", "u_1")).toEqual({
      lowUserId: "u_1",
      highUserId: "u_10",
    });
  });

  it("is order-independent for a spread of realistic ids", () => {
    const ids = [
      "u_m9x0100abcdefgh",
      "u_m9x0101abcdefgh",
      "u_m9x0100abcdefgi",
      "u_M9X0100ABCDEFGH",
      "u_00000000zzzzzzzz",
    ];

    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(orderPair(a, b)).toEqual(orderPair(b, a));
      }
    }
  });

  it("refuses a conversation with yourself", () => {
    expect(() => orderPair("u_alice", "u_alice")).toThrow("same_user");
  });

  it("refuses an empty id rather than inventing a pair", () => {
    expect(() => orderPair("", "u_bob")).toThrow("missing_user_id");
    expect(() => orderPair("u_alice", "")).toThrow("missing_user_id");
  });
});

describe("sideOf and otherUserId", () => {
  const row = { lowUserId: "u_alice", highUserId: "u_bob" };

  it("places each participant on their own side", () => {
    expect(sideOf(row, "u_alice")).toBe("low");
    expect(sideOf(row, "u_bob")).toBe("high");
  });

  it("returns null for anyone else, including nobody", () => {
    expect(sideOf(row, "u_carol")).toBeNull();
    expect(sideOf(row, null)).toBeNull();
    expect(sideOf(row, undefined)).toBeNull();
    expect(sideOf(row, "")).toBeNull();
  });

  it("names the other participant, and refuses to for a stranger", () => {
    expect(otherUserId(row, "u_alice")).toBe("u_bob");
    expect(otherUserId(row, "u_bob")).toBe("u_alice");
    expect(otherUserId(row, "u_carol")).toBeNull();
  });
});

describe("isUnreadFor", () => {
  const base = {
    lowUserId: "u_alice",
    highUserId: "u_bob",
    lastMessageAt: 1000,
    lastSenderId: "u_bob",
    lowReadAt: null as number | null,
    highReadAt: null as number | null,
  };

  it("is unread when the recipient has never opened the thread", () => {
    expect(isUnreadFor(base, "u_alice")).toBe(true);
  });

  it("is unread when the cursor is older than the last message", () => {
    expect(isUnreadFor({ ...base, lowReadAt: 999 }, "u_alice")).toBe(true);
  });

  it("is read once the cursor catches up", () => {
    expect(isUnreadFor({ ...base, lowReadAt: 1000 }, "u_alice")).toBe(false);
    expect(isUnreadFor({ ...base, lowReadAt: 1001 }, "u_alice")).toBe(false);
  });

  it("never marks your own message unread to you", () => {
    expect(isUnreadFor(base, "u_bob")).toBe(false);
    expect(isUnreadFor({ ...base, highReadAt: null }, "u_bob")).toBe(false);
  });

  it("reads the cursor belonging to the right side", () => {
    const fromAlice = { ...base, lastSenderId: "u_alice", highReadAt: 500 };
    expect(isUnreadFor(fromAlice, "u_bob")).toBe(true);
    expect(isUnreadFor({ ...fromAlice, highReadAt: 1000 }, "u_bob")).toBe(false);
  });

  it("says nothing is unread for someone who is not in the thread", () => {
    expect(isUnreadFor(base, "u_carol")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Message text                                                               */
/* -------------------------------------------------------------------------- */

describe("messagePreview", () => {
  it("passes a short line through unchanged", () => {
    expect(messagePreview("Are you taking Nurgle work?")).toBe(
      "Are you taking Nurgle work?",
    );
  });

  it("collapses newlines, because the inbox shows one line", () => {
    expect(messagePreview("Hello\n\nthere\tfriend  ")).toBe("Hello there friend");
  });

  it("truncates with an ellipsis rather than mid-word nonsense", () => {
    const long = "a".repeat(200);
    const preview = messagePreview(long);
    expect(preview).toHaveLength(140);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a message exactly at the limit alone", () => {
    const exact = "b".repeat(140);
    expect(messagePreview(exact)).toBe(exact);
  });

  it("honours a custom limit", () => {
    expect(messagePreview("abcdef", 4)).toBe("abc…");
  });
});

describe("validateMessageBody", () => {
  it("accepts an ordinary message and trims it", () => {
    expect(validateMessageBody("  hello  ")).toEqual({ ok: true, body: "hello" });
  });

  it("refuses nothing at all", () => {
    expect(validateMessageBody("").ok).toBe(false);
    expect(validateMessageBody("   \n\t ").ok).toBe(false);
    expect(validateMessageBody(undefined).ok).toBe(false);
    expect(validateMessageBody(42).ok).toBe(false);
  });

  it("accepts exactly the maximum and refuses one more", () => {
    expect(validateMessageBody("x".repeat(4000)).ok).toBe(true);
    expect(validateMessageBody("x".repeat(4001)).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

describe("parsePounds", () => {
  it("treats blank as 'ask', not as free", () => {
    expect(parsePounds(null)).toEqual({ ok: true, pence: null });
    expect(parsePounds(undefined)).toEqual({ ok: true, pence: null });
    expect(parsePounds("")).toEqual({ ok: true, pence: null });
    expect(parsePounds("   ")).toEqual({ ok: true, pence: null });
  });

  it("converts whole pounds", () => {
    expect(parsePounds("12")).toEqual({ ok: true, pence: 1200 });
    expect(parsePounds(12)).toEqual({ ok: true, pence: 1200 });
  });

  it("reads one decimal digit as tenths, not hundredths", () => {
    expect(parsePounds("12.5")).toEqual({ ok: true, pence: 1250 });
    expect(parsePounds("12.50")).toEqual({ ok: true, pence: 1250 });
    expect(parsePounds("12.05")).toEqual({ ok: true, pence: 1205 });
  });

  it("lands exactly on the price floating point cannot hold", () => {
    expect(parsePounds("47.99")).toEqual({ ok: true, pence: 4799 });
    expect(parsePounds("0.10")).toEqual({ ok: true, pence: 10 });
  });

  it("tolerates the ways people actually type money", () => {
    expect(parsePounds("£12.50")).toEqual({ ok: true, pence: 1250 });
    expect(parsePounds(" 1,200 ")).toEqual({ ok: true, pence: 120000 });
  });

  it("refuses zero, because free is not what a blank field means", () => {
    expect(parsePounds("0").ok).toBe(false);
    expect(parsePounds("0.00").ok).toBe(false);
  });

  it("refuses anything that is not a plain amount", () => {
    expect(parsePounds("-5").ok).toBe(false);
    expect(parsePounds("abc").ok).toBe(false);
    expect(parsePounds("12.345").ok).toBe(false);
    expect(parsePounds("1e3").ok).toBe(false);
    expect(parsePounds("12,50").ok).toBe(true); // comma stripped: £1250
    expect(parsePounds({}).ok).toBe(false);
  });

  it("refuses a typo the size of a house", () => {
    expect(parsePounds("100001").ok).toBe(false);
  });
});

describe("priceRangeError", () => {
  it("objects when the range counts downwards", () => {
    expect(priceRangeError(2500, 1200)).toBeTruthy();
  });

  it("allows a single fixed price expressed as a flat range", () => {
    expect(priceRangeError(1200, 1200)).toBeNull();
  });

  it("allows an open-ended range in either direction", () => {
    expect(priceRangeError(1200, null)).toBeNull();
    expect(priceRangeError(null, 2500)).toBeNull();
    expect(priceRangeError(null, null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The listing form                                                           */
/* -------------------------------------------------------------------------- */

const GOOD = {
  title: "Tabletop-plus 40K infantry",
  blurb: "Airbrushed base coats, edge highlights, transfers, textured bases.",
  priceFrom: "12",
  priceTo: "25",
  priceUnit: "model",
  turnaroundDays: "21",
  gameSystems: ["warhammer-40k", "kill-team"],
  location: "Bristol",
};

describe("validateCommission", () => {
  it("accepts a filled-in form and converts the prices to pence", () => {
    const result = validateCommission(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.values.priceFromPence).toBe(1200);
    expect(result.values.priceToPence).toBe(2500);
    expect(result.values.turnaroundDays).toBe(21);
    expect(result.values.gameSystems).toEqual(["warhammer-40k", "kill-team"]);
    // Nobody fills in a listing intending to be unavailable.
    expect(result.values.openToWork).toBe(true);
  });

  it("insists on a name and a description", () => {
    const result = validateCommission({ ...GOOD, title: "  ", blurb: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.title).toBeTruthy();
    expect(result.fields.blurb).toBeTruthy();
  });

  it("rejects a range where 'from' is above 'to', against the 'to' field", () => {
    const result = validateCommission({ ...GOOD, priceFrom: "40", priceTo: "10" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.priceTo).toBeTruthy();
    expect(result.fields.priceFrom).toBeUndefined();
  });

  it("keeps a blank price as null rather than zero", () => {
    const result = validateCommission({ ...GOOD, priceFrom: "", priceTo: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.priceFromPence).toBeNull();
    expect(result.values.priceToPence).toBeNull();
  });

  it("drops systems it does not recognise instead of storing them", () => {
    const result = validateCommission({
      ...GOOD,
      gameSystems: ["warhammer-40k", "sculpting-lego", 7, "warhammer-40k"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.gameSystems).toEqual(["warhammer-40k"]);
  });

  it("caps the number of systems", () => {
    const result = validateCommission({
      ...GOOD,
      gameSystems: [
        "warhammer-40k",
        "age-of-sigmar",
        "kill-team",
        "necromunda",
        "horus-heresy",
        "warcry",
        "blood-bowl",
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.gameSystems).toBeTruthy();
  });

  it("checks the turnaround is a sensible whole number of days", () => {
    expect(validateCommission({ ...GOOD, turnaroundDays: "0" }).ok).toBe(false);
    expect(validateCommission({ ...GOOD, turnaroundDays: "400" }).ok).toBe(false);
    expect(validateCommission({ ...GOOD, turnaroundDays: "2.5" }).ok).toBe(false);
    expect(validateCommission({ ...GOOD, turnaroundDays: "soon" }).ok).toBe(false);

    const blank = validateCommission({ ...GOOD, turnaroundDays: "" });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.values.turnaroundDays).toBeNull();
  });

  it("falls back to a sane unit rather than storing junk", () => {
    const result = validateCommission({ ...GOOD, priceUnit: "per fortnight" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.priceUnit).toBe("model");
  });

  it("keeps an explicit closed book closed", () => {
    const result = validateCommission({ ...GOOD, openToWork: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.openToWork).toBe(false);
  });

  it("refuses a title longer than the column takes", () => {
    const result = validateCommission({ ...GOOD, title: "x".repeat(121) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.title).toBeTruthy();
  });

  it("survives being handed nothing at all", () => {
    expect(validateCommission(undefined).ok).toBe(false);
    expect(validateCommission("not a form").ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Browse cursor                                                              */
/* -------------------------------------------------------------------------- */

describe("browse cursor", () => {
  it("round-trips", () => {
    const cursor = { open: 1 as const, updatedAt: 1_800_000_000, id: "cm_abc" };
    expect(decodeBrowseCursor(encodeBrowseCursor(cursor))).toEqual(cursor);
  });

  it("keeps the closed-books half of the ordering", () => {
    const cursor = { open: 0 as const, updatedAt: 12, id: "cm_x" };
    expect(decodeBrowseCursor(encodeBrowseCursor(cursor))).toEqual(cursor);
  });

  it("treats anything malformed as no cursor at all", () => {
    expect(encodeBrowseCursor(null)).toBeNull();
    expect(decodeBrowseCursor(null)).toBeNull();
    expect(decodeBrowseCursor("")).toBeNull();
    expect(decodeBrowseCursor("nonsense")).toBeNull();
    expect(decodeBrowseCursor("1~notanumber~cm_x")).toBeNull();
    expect(decodeBrowseCursor("2~12~cm_x")).toBeNull();
    expect(decodeBrowseCursor("1~12~")).toBeNull();
  });
});
