import { describe, expect, it } from "vitest";
import { buildShareLinks } from "../app/lib/share";
import { normalisePin } from "../server/api/validators";

/*
 * Share links are plain URLs to public composers — the whole point is that no
 * SDK and no cookie is involved, so the only thing to get wrong is the encoding
 * and the target set.
 */
describe("buildShareLinks", () => {
  const url = "https://spruetube.app/posts/p_1";
  const text = "Death Guard, finally based";

  it("offers the targets the hobby uses", () => {
    const keys = buildShareLinks(url, text).map((t) => t.key);
    expect(keys).toEqual([
      "x",
      "facebook",
      "reddit",
      "bluesky",
      "whatsapp",
      "email",
    ]);
  });

  it("encodes the url and text into every target", () => {
    const links = buildShareLinks(url, text);
    for (const link of links) {
      // Nothing raw and un-encoded should survive into the href.
      expect(link.href).not.toContain(" ");
      expect(link.href).toContain(encodeURIComponent(url));
    }
  });

  it("carries the text where the network takes one", () => {
    const x = buildShareLinks(url, text).find((t) => t.key === "x")!;
    expect(x.href).toContain(encodeURIComponent(text));
  });

  it("escapes characters that would break a query string", () => {
    const links = buildShareLinks(
      "https://spruetube.app/posts/p_1?a=b&c=d",
      "red & black — 100% done",
    );
    const reddit = links.find((t) => t.key === "reddit")!;
    expect(reddit.href).toContain(encodeURIComponent("red & black — 100% done"));
    expect(reddit.href).toContain(
      encodeURIComponent("https://spruetube.app/posts/p_1?a=b&c=d"),
    );
  });
});

/*
 * normalisePin is the guard between a user-typed value and a pin row. A system
 * must be a real slug; a tag is lowercased so a pin can never disagree on case
 * with the tag it points at.
 */
describe("normalisePin", () => {
  it("accepts a real game system", () => {
    expect(normalisePin({ kind: "system", value: "warhammer-40k" })).toEqual({
      kind: "system",
      value: "warhammer-40k",
    });
  });

  it("rejects a made-up system", () => {
    expect(normalisePin({ kind: "system", value: "not-a-game" })).toBeNull();
  });

  it("lowercases a tag", () => {
    expect(normalisePin({ kind: "tag", value: "DeathGuard" })).toEqual({
      kind: "tag",
      value: "deathguard",
    });
  });

  it("rejects a tag with illegal characters or wrong length", () => {
    expect(normalisePin({ kind: "tag", value: "a" })).toBeNull();
    expect(normalisePin({ kind: "tag", value: "has space" })).toBeNull();
    expect(normalisePin({ kind: "tag", value: "with-hyphen" })).toBeNull();
  });
});
