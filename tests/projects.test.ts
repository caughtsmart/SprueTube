import { describe, expect, it } from "vitest";
import {
  compareEntries,
  moveEntry,
  planReorder,
  sameOrder,
  sortEntries,
  type OrderableEntry,
} from "../app/lib/build-log";
import {
  checkCommentTarget,
  decodeEntryCursor,
  encodeEntryCursor,
  groupCommentsByMedia,
  threadComments,
} from "../server/services/projects";

/*
 * Build logs — the pure parts.
 *
 * Kept out of tests/logic.test.ts so two people can work on the two features at
 * once without meeting in the same file.
 */

const entry = (
  id: string,
  projectPosition: number | null,
  publishedAt: number | null,
): OrderableEntry => ({ id, projectPosition, publishedAt });

describe("build log ordering", () => {
  it("puts an entry with a manual position ahead of every entry without one", () => {
    // This is the whole reason the column can stay sparse, and it is also the
    // surprising half of the rule: moving one entry to the top does not need
    // the other two hundred renumbered.
    const sorted = sortEntries([
      entry("p_a", null, 100),
      entry("p_b", null, 200),
      entry("p_c", 0, 999),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["p_c", "p_a", "p_b"]);
  });

  it("orders manual positions ascending", () => {
    const sorted = sortEntries([
      entry("p_a", 2, 100),
      entry("p_b", 0, 100),
      entry("p_c", 1, 100),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["p_b", "p_c", "p_a"]);
  });

  it("falls back to oldest first, not newest first", () => {
    // The opposite of every other listing on the site. A build log is a story.
    const sorted = sortEntries([
      entry("p_a", null, 300),
      entry("p_b", null, 100),
      entry("p_c", null, 200),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["p_b", "p_c", "p_a"]);
  });

  it("breaks a same-second tie on the id so the order never shuffles", () => {
    const sorted = sortEntries([
      entry("p_003", null, 100),
      entry("p_001", null, 100),
      entry("p_002", null, 100),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["p_001", "p_002", "p_003"]);
  });

  it("treats an unpublished entry with no date as the oldest", () => {
    // publishedAt is null on a draft, and the SQL coalesces it to 0. If the two
    // disagreed, an owner's draft would jump around between page loads.
    const sorted = sortEntries([entry("p_a", null, 5), entry("p_b", null, null)]);
    expect(sorted.map((e) => e.id)).toEqual(["p_b", "p_a"]);
  });

  it("sorts the same list the same way whatever order it arrives in", () => {
    const rows = [
      entry("p_e", null, 400),
      entry("p_d", 1, 50),
      entry("p_c", null, 100),
      entry("p_b", 0, 900),
      entry("p_a", null, 100),
    ];
    const forwards = sortEntries(rows).map((e) => e.id);
    const backwards = sortEntries([...rows].reverse()).map((e) => e.id);
    expect(forwards).toEqual(["p_b", "p_d", "p_a", "p_c", "p_e"]);
    expect(backwards).toEqual(forwards);
  });

  it("does not mutate the list it was given", () => {
    const rows = [entry("p_b", null, 200), entry("p_a", null, 100)];
    sortEntries(rows);
    expect(rows.map((e) => e.id)).toEqual(["p_b", "p_a"]);
  });

  it("is a consistent comparator", () => {
    const a = entry("p_a", 1, 100);
    const b = entry("p_b", null, 100);
    expect(compareEntries(a, b)).toBeLessThan(0);
    expect(compareEntries(b, a)).toBeGreaterThan(0);
    expect(compareEntries(a, a)).toBe(0);
  });
});

describe("moveEntry", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("swaps with the neighbour above", () => {
    expect(moveEntry(rows, "c", "up").map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("swaps with the neighbour below", () => {
    expect(moveEntry(rows, "a", "down").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("does nothing at either end rather than wrapping", () => {
    // A wrap would send the first entry of a two-year log to the bottom on a
    // mis-tap, and the undo for that is thirty more taps.
    expect(moveEntry(rows, "a", "up").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(moveEntry(rows, "c", "down").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ignores an id that is not in the list", () => {
    expect(moveEntry(rows, "z", "up").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("leaves the original list alone", () => {
    moveEntry(rows, "a", "down");
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("planReorder", () => {
  const inProject = ["p_a", "p_b", "p_c"];

  it("numbers the requested order from zero", () => {
    expect(planReorder(["p_c", "p_a", "p_b"], inProject)).toEqual([
      { id: "p_c", position: 0 },
      { id: "p_a", position: 1 },
      { id: "p_b", position: 2 },
    ]);
  });

  it("drops an id that is not in this build log", () => {
    // Someone else's post id, or one deleted since the page loaded. Saving the
    // rest of the order beats refusing the whole thing.
    expect(planReorder(["p_c", "p_someone_else"], inProject)).toEqual([
      { id: "p_c", position: 0 },
    ]);
  });

  it("keeps only the first mention of a duplicated id", () => {
    expect(planReorder(["p_a", "p_b", "p_a"], inProject)).toEqual([
      { id: "p_a", position: 0 },
      { id: "p_b", position: 1 },
    ]);
  });

  it("never assigns a position to an entry that was not sent", () => {
    // The column is sparse on purpose; an entry nobody moved keeps its null.
    const plan = planReorder(["p_b", "p_a"], inProject);
    expect(plan.map((row) => row.id)).not.toContain("p_c");
  });

  it("returns nothing for an empty request", () => {
    expect(planReorder([], inProject)).toEqual([]);
  });

  it("produces positions that reproduce the requested order", () => {
    const requested = ["p_c", "p_b", "p_a"];
    const plan = planReorder(requested, inProject);
    const sorted = sortEntries(
      plan.map((row) => entry(row.id, row.position, 0)),
    );
    expect(sorted.map((row) => row.id)).toEqual(requested);
  });
});

describe("sameOrder", () => {
  it("spots an unchanged list", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("spots a swap and a length change", () => {
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});

describe("entry cursors", () => {
  it("round-trips a positioned entry", () => {
    const cursor = { position: 3, publishedAt: 1786059575, id: "p_0msi5r8lx0" };
    expect(decodeEntryCursor(encodeEntryCursor(cursor))).toEqual(cursor);
  });

  it("round-trips an entry with no manual position", () => {
    // The empty first field is what says "past every positioned entry", so it
    // has to survive the trip rather than decoding as zero.
    const cursor = { position: null, publishedAt: 1786059575, id: "p_abc" };
    const decoded = decodeEntryCursor(encodeEntryCursor(cursor));
    expect(decoded).toEqual(cursor);
    expect(decoded!.position).not.toBe(0);
  });

  it("survives position zero", () => {
    const cursor = { position: 0, publishedAt: 1, id: "p_abc" };
    expect(decodeEntryCursor(encodeEntryCursor(cursor))).toEqual(cursor);
  });

  it("copes with a draft's missing date", () => {
    const cursor = { position: null, publishedAt: 0, id: "p_abc" };
    expect(decodeEntryCursor(encodeEntryCursor(cursor))).toEqual(cursor);
  });

  it("treats junk as no cursor rather than throwing", () => {
    expect(decodeEntryCursor("garbage")).toBeNull();
    expect(decodeEntryCursor("1~2")).toBeNull();
    expect(decodeEntryCursor("1~notanumber~p_a")).toBeNull();
    expect(decodeEntryCursor("1.5~2~p_a")).toBeNull();
    expect(decodeEntryCursor("1~2~")).toBeNull();
    expect(decodeEntryCursor("")).toBeNull();
    expect(decodeEntryCursor(null)).toBeNull();
  });

  it("encodes nothing for no cursor", () => {
    expect(encodeEntryCursor(null)).toBeNull();
  });
});

describe("comment targets", () => {
  it("accepts a comment on a post", () => {
    expect(checkCommentTarget({ postId: "p_1" })).toBeNull();
  });

  it("accepts a comment on one photo inside a post", () => {
    // The post id travels with the media id so the cascade, the post's comment
    // count and moderation all keep working without knowing photo comments
    // exist.
    expect(checkCommentTarget({ postId: "p_1", mediaId: "m_1" })).toBeNull();
  });

  it("accepts a comment on a build log", () => {
    expect(checkCommentTarget({ projectId: "prj_1" })).toBeNull();
  });

  it("rejects a comment attached to nothing", () => {
    expect(checkCommentTarget({})).toBe("no_target");
    expect(checkCommentTarget({ postId: null, projectId: null })).toBe(
      "no_target",
    );
  });

  it("rejects a comment attached to both a post and a build log", () => {
    // Both counters would be incremented for one row, and deleting it would
    // decrement both. The invariant exists to stop exactly that.
    expect(checkCommentTarget({ postId: "p_1", projectId: "prj_1" })).toBe(
      "both_targets",
    );
  });

  it("rejects a photo comment with no post", () => {
    expect(checkCommentTarget({ mediaId: "m_1" })).toBe("no_target");
    expect(checkCommentTarget({ projectId: "prj_1", mediaId: "m_1" })).toBe(
      "media_without_post",
    );
  });
});

describe("threadComments", () => {
  const rows = [
    { id: "c_1", parentId: null },
    { id: "c_2", parentId: "c_1" },
    { id: "c_3", parentId: null },
    { id: "c_4", parentId: "c_1" },
  ];

  it("nests replies under their root, keeping order", () => {
    const threads = threadComments(rows);
    expect(threads.map((t) => t.id)).toEqual(["c_1", "c_3"]);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["c_2", "c_4"]);
    expect(threads[1]!.replies).toEqual([]);
  });

  it("drops a reply whose parent has been removed", () => {
    // Removed comments never reach this function, so an orphan means the parent
    // was moderated away. A reply read without the thing it replies to reads
    // worse than nothing.
    const threads = threadComments([{ id: "c_9", parentId: "c_gone" }]);
    expect(threads).toEqual([]);
  });

  it("handles an empty thread", () => {
    expect(threadComments([])).toEqual([]);
  });
});

describe("groupCommentsByMedia", () => {
  it("keys photo comments by their image", () => {
    const grouped = groupCommentsByMedia([
      { mediaId: "m_1" },
      { mediaId: "m_2" },
      { mediaId: "m_1" },
    ]);
    expect(grouped.get("m_1")).toHaveLength(2);
    expect(grouped.get("m_2")).toHaveLength(1);
  });

  it("ignores comments about the whole post", () => {
    const grouped = groupCommentsByMedia([{ mediaId: null }]);
    expect(grouped.size).toBe(0);
  });
});
