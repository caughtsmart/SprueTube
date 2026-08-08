import { describe, expect, it } from "vitest";
import { hotScore } from "../server/services/ranking";
import { extractHashtags, extractMentions } from "../server/services/posts";
import { ageFromBirthdate } from "../server/services/moderation";
import { adSlotIndices } from "../server/services/ads";
import { idTimestamp, newId } from "../server/db/id";
import { compactCount, excerpt, parseBody } from "../app/lib/format";
import { imageSrc } from "../app/lib/media";
import { OPERATOR, operatorLine, operatorReady } from "../app/lib/legal";
import {
  escapeHtml,
  resetPasswordEmail,
  verifyEmail,
} from "../server/services/email";
import { decodeCursor, encodeCursor } from "../server/services/feed";
import {
  suggestUsername,
  validateUsername,
} from "../server/services/usernames";

const HOUR = 3600;
const now = 1_800_000_000;

describe("hotScore", () => {
  it("ranks a fresh post above an old one with the same engagement", () => {
    const fresh = hotScore({
      likeCount: 10,
      commentCount: 2,
      viewCount: 100,
      publishedAt: now - HOUR,
      now,
    });
    const stale = hotScore({
      likeCount: 10,
      commentCount: 2,
      viewCount: 100,
      publishedAt: now - 7 * 24 * HOUR,
      now,
    });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("lets a much older post win if the engagement gap is large enough", () => {
    const quiet = hotScore({
      likeCount: 1,
      commentCount: 0,
      viewCount: 0,
      publishedAt: now - HOUR,
      now,
    });
    const loved = hotScore({
      likeCount: 400,
      commentCount: 60,
      viewCount: 9000,
      publishedAt: now - 12 * HOUR,
      now,
    });
    expect(loved).toBeGreaterThan(quiet);
  });

  it("weighs a comment more heavily than a like", () => {
    const base = { viewCount: 0, publishedAt: now, now };
    const liked = hotScore({ ...base, likeCount: 3, commentCount: 0 });
    const discussed = hotScore({ ...base, likeCount: 0, commentCount: 3 });
    expect(discussed).toBeGreaterThan(liked);
  });

  it("gives a brand-new post with nothing on it a positive score", () => {
    // Otherwise a new post sorts below every old post and is never seen.
    expect(
      hotScore({
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        publishedAt: now,
        now,
      }),
    ).toBeGreaterThan(0);
  });
});

describe("hashtags and mentions", () => {
  it("pulls tags out of a body, lowercased and deduped", () => {
    expect(
      extractHashtags("Rust on the #DeathGuard, more #deathguard than planned"),
    ).toEqual(["deathguard"]);
  });

  it("ignores a # inside a word", () => {
    expect(extractHashtags("colour#3 is the one")).toEqual([]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
    expect(extractHashtags(many).length).toBeLessThanOrEqual(10);
  });

  it("finds mentions", () => {
    expect(extractMentions("nice one @grahampaints and @kimbuilds")).toEqual([
      "grahampaints",
      "kimbuilds",
    ]);
  });

  it("does not treat an email address as a mention", () => {
    expect(extractMentions("mail me at someone@example.com")).toEqual([]);
  });
});

describe("parseBody", () => {
  it("splits text, tags, mentions and links", () => {
    const segments = parseBody("hi @kim see #wip at https://example.com/x");
    expect(segments.map((s) => s.type)).toEqual([
      "text",
      "mention",
      "text",
      "tag",
      "text",
      "link",
    ]);
  });

  it("returns the body verbatim when there is nothing to link", () => {
    // The renderer never uses dangerouslySetInnerHTML, so markup in a body has
    // to survive as plain text rather than being stripped or executed.
    const raw = '<script>alert("x")</script>';
    expect(parseBody(raw)).toEqual([{ type: "text", value: raw }]);
  });
});

describe("ageFromBirthdate", () => {
  const today = new Date("2026-08-06T00:00:00Z");

  it("computes a whole number of years", () => {
    expect(ageFromBirthdate("1985-04-12", today)).toBe(41);
  });

  it("does not round up before the birthday", () => {
    expect(ageFromBirthdate("2013-08-07", today)).toBe(12);
    expect(ageFromBirthdate("2013-08-06", today)).toBe(13);
  });

  it("rejects nonsense", () => {
    expect(ageFromBirthdate("not-a-date")).toBeNull();
  });
});

describe("usernames", () => {
  it("rejects reserved names", () => {
    expect(validateUsername("admin")).toBe("reserved");
    expect(validateUsername("SprueTube")).toBe("reserved");
  });

  it("rejects awkward characters", () => {
    expect(validateUsername("graham paints")).toBe("invalid_characters");
    expect(validateUsername("gráham")).toBe("invalid_characters");
  });

  it("accepts a normal one", () => {
    expect(validateUsername("graham_paints99")).toBeNull();
  });

  it("suggests something usable from an email", () => {
    const suggested = suggestUsername(null, "graham.smith@example.com");
    expect(suggested).toMatch(/^[a-zA-Z0-9_]+$/);
    expect(suggested.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ids", () => {
  it("sorts lexicographically by creation order", () => {
    const ids = Array.from({ length: 200 }, () => newId("p"));
    expect([...ids].sort()).toEqual(ids);
  });

  it("never collides inside one millisecond", () => {
    const ids = Array.from({ length: 500 }, () => newId("p"));
    expect(new Set(ids).size).toBe(500);
  });

  it("round-trips its timestamp", () => {
    const before = Date.now();
    const stamp = idTimestamp(newId("p"));
    expect(stamp).not.toBeNull();
    expect(stamp!).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("feed cursors", () => {
  it("round-trips", () => {
    const cursor = { score: 1786059575, id: "p_0msi5r8lx00hi24s82j" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("survives a fractional hot score", () => {
    const cursor = { score: 0.0123456789, id: "p_abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("treats junk as no cursor rather than throwing", () => {
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});

describe("ad placement", () => {
  it("never puts an advert first", () => {
    expect(adSlotIndices(20)[0]).toBeGreaterThan(0);
  });

  it("places nothing in a short feed", () => {
    expect(adSlotIndices(3)).toEqual([]);
  });

  it("spaces them evenly", () => {
    const indices = adSlotIndices(25);
    const gaps = indices.slice(1).map((value, i) => value - indices[i]!);
    expect(new Set(gaps).size).toBeLessThanOrEqual(1);
  });
});

describe("media URLs", () => {
  const configured = { imagesAccountHash: "abc123" };
  const placeholders = { imagesAccountHash: "REPLACE_WITH_IMAGES_ACCOUNT_HASH" };

  it("builds a delivery URL when configured", () => {
    expect(imageSrc(configured, "img1", "feed")).toBe(
      "https://imagedelivery.net/abc123/img1/feed",
    );
  });

  it("returns null rather than a URL built from a placeholder", () => {
    // A preview deploy happens before Cloudflare Images is switched on. A
    // placeholder is a non-empty string, so an emptiness check alone would ship
    // a page full of broken images.
    expect(imageSrc(placeholders, "img1")).toBeNull();
  });

  it("returns null when there is no media id at all", () => {
    expect(imageSrc(configured, null)).toBeNull();
    expect(imageSrc(configured, undefined)).toBeNull();
  });

  it("treats empty config as unconfigured", () => {
    expect(imageSrc({ imagesAccountHash: "" }, "img1")).toBeNull();
  });
});

describe("formatting", () => {
  it("compacts large counts", () => {
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1200)).toBe("1.2k");
    expect(compactCount(15_400)).toBe("15k");
    expect(compactCount(2_300_000)).toBe("2.3m");
  });

  it("trims an excerpt without cutting mid-ellipsis", () => {
    const long = "a".repeat(400);
    const trimmed = excerpt(long, 50);
    expect(trimmed.length).toBe(50);
    expect(trimmed.endsWith("…")).toBe(true);
  });
});

describe("transactional email", () => {
  const url = "https://spruetube.app/api/auth/reset-password/tok?callbackURL=%2F";

  it("puts the link in both the HTML and the plain text part", () => {
    const message = resetPasswordEmail({
      to: "painter@example.com",
      name: "Graham",
      url,
    });
    expect(message.html).toContain(url);
    expect(message.text).toContain(url);
  });

  it("escapes a display name before interpolating it into the HTML", () => {
    // Display names are user-controlled and never sanitised on the way in.
    const message = verifyEmail({
      to: "painter@example.com",
      name: '<img src=x onerror="alert(1)">',
      url,
    });
    expect(message.html).not.toContain("<img src=x");
    expect(message.html).toContain("&lt;img src=x");
  });

  it("keeps the plain text part free of markup", () => {
    const message = resetPasswordEmail({
      to: "painter@example.com",
      name: "Graham",
      url,
    });
    expect(message.text).not.toContain("<");
  });

  it("escapes every character that could break out of an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("operator details", () => {
  it("refuses to look finished while the legal name is unset", () => {
    // The banner on /privacy and /terms is driven by this, so a false here is
    // what keeps the "not reviewed yet" warning on the page.
    expect(operatorReady()).toBe(Boolean(OPERATOR.legalName && OPERATOR.address));
  });

  it("renders a visible placeholder rather than a gap", () => {
    // A document that reads "SprueTube is operated by ." is worse than one that
    // says plainly that nobody filled it in.
    expect(operatorLine()).not.toBe("");
    if (!OPERATOR.legalName) expect(operatorLine()).toContain("NOT SET");
  });

  it("includes the company number only when there is one", () => {
    const line = operatorLine();
    if (OPERATOR.companyNumber) {
      expect(line).toContain(OPERATOR.companyNumber);
    } else {
      expect(line).not.toContain("company ");
    }
  });
});
