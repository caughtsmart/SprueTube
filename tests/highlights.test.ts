import { describe, expect, it } from "vitest";
import {
  assembleImageHighlights,
  assembleProjectHighlights,
  authorIdsIn,
  capPerAuthor,
  filterHidden,
  type HighlightImage,
  type HighlightProject,
  type ImageMediaRow,
  type ImagePostRow,
  type ProjectRow,
} from "../server/services/highlights";

/*
 * Query-level rules — published only, public only, no suspended authors — are
 * enforced in SQL and are not testable here. What is testable is everything
 * after the rows come back: which project a total belongs to, which photograph
 * stands for a post, and what the viewer's blocks do to the result.
 */

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "pr_1",
    title: "Leviathan Crusade",
    slug: "leviathan-crusade",
    summary: null,
    coverImageId: null,
    ownerId: "u_1",
    ownerUsername: "graham",
    ownerDisplayName: "Graham",
    ...overrides,
  };
}

function postRow(overrides: Partial<ImagePostRow> = {}): ImagePostRow {
  return {
    postId: "p_1",
    likeCount: 10,
    authorId: "u_1",
    username: "graham",
    displayName: "Graham",
    ...overrides,
  };
}

function mediaRow(overrides: Partial<ImageMediaRow> = {}): ImageMediaRow {
  return {
    id: "m_1",
    postId: "p_1",
    imageId: "img_1",
    position: 0,
    width: 1600,
    height: 1200,
    altText: null,
    ...overrides,
  };
}

describe("assembleProjectHighlights", () => {
  const projects = [
    projectRow({ id: "pr_1", ownerId: "u_1" }),
    projectRow({ id: "pr_2", ownerId: "u_2", ownerUsername: "kim" }),
  ];

  it("orders by total likes regardless of the order rows arrive in", () => {
    const result = assembleProjectHighlights({
      totals: [
        { projectId: "pr_1", likeTotal: 12, postsCounted: 3 },
        { projectId: "pr_2", likeTotal: 90, postsCounted: 11 },
      ],
      projects,
      coverFallbacks: [],
      limit: 5,
    });
    expect(result.map((entry) => entry.id)).toEqual(["pr_2", "pr_1"]);
    expect(result[0]!.likeTotal).toBe(90);
    expect(result[0]!.postsCounted).toBe(11);
  });

  it("drops a total whose project is missing", () => {
    // Which is how a suspended owner's build log disappears: the project query
    // filters them out, so the total has nothing to join to.
    const result = assembleProjectHighlights({
      totals: [
        { projectId: "pr_gone", likeTotal: 500, postsCounted: 20 },
        { projectId: "pr_1", likeTotal: 4, postsCounted: 1 },
      ],
      projects,
      coverFallbacks: [],
      limit: 5,
    });
    expect(result.map((entry) => entry.id)).toEqual(["pr_1"]);
  });

  it("leaves out build logs nobody has liked", () => {
    const result = assembleProjectHighlights({
      totals: [{ projectId: "pr_1", likeTotal: 0, postsCounted: 6 }],
      projects,
      coverFallbacks: [],
      limit: 5,
    });
    expect(result).toEqual([]);
  });

  it("keeps the owner's own cover when there is one", () => {
    const result = assembleProjectHighlights({
      totals: [{ projectId: "pr_1", likeTotal: 5, postsCounted: 2 }],
      projects: [projectRow({ id: "pr_1", coverImageId: "img_chosen" })],
      coverFallbacks: [
        { projectId: "pr_1", imageId: "img_post", position: 0, createdAt: 99 },
      ],
      limit: 5,
    });
    expect(result[0]!.coverImageId).toBe("img_chosen");
  });

  it("falls back to the newest photograph in the build log", () => {
    const result = assembleProjectHighlights({
      totals: [{ projectId: "pr_1", likeTotal: 5, postsCounted: 2 }],
      projects: [projectRow({ id: "pr_1", coverImageId: null })],
      coverFallbacks: [
        { projectId: "pr_1", imageId: "img_old", position: 0, createdAt: 10 },
        { projectId: "pr_1", imageId: "img_new", position: 0, createdAt: 90 },
        { projectId: "pr_1", imageId: "img_new_2", position: 1, createdAt: 90 },
      ],
      limit: 5,
    });
    expect(result[0]!.coverImageId).toBe("img_new");
  });

  it("renders a build log with no image at all rather than dropping it", () => {
    const result = assembleProjectHighlights({
      totals: [{ projectId: "pr_1", likeTotal: 5, postsCounted: 2 }],
      projects: [projectRow({ id: "pr_1", coverImageId: null })],
      coverFallbacks: [],
      limit: 5,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.coverImageId).toBeNull();
  });

  it("respects the limit", () => {
    const result = assembleProjectHighlights({
      totals: [
        { projectId: "pr_1", likeTotal: 12, postsCounted: 3 },
        { projectId: "pr_2", likeTotal: 90, postsCounted: 11 },
      ],
      projects,
      coverFallbacks: [],
      limit: 1,
    });
    expect(result.map((entry) => entry.id)).toEqual(["pr_2"]);
  });
});

describe("assembleImageHighlights", () => {
  it("shows one photograph per post, the first of the set", () => {
    const result = assembleImageHighlights({
      posts: [postRow({ postId: "p_1" })],
      media: [
        mediaRow({ id: "m_2", postId: "p_1", imageId: "b", position: 1 }),
        mediaRow({ id: "m_1", postId: "p_1", imageId: "a", position: 0 }),
        mediaRow({ id: "m_3", postId: "p_1", imageId: "c", position: 2 }),
      ],
      limit: 10,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.imageId).toBe("a");
  });

  it("orders by the post's like count", () => {
    const result = assembleImageHighlights({
      posts: [
        postRow({ postId: "p_1", likeCount: 3, authorId: "u_1" }),
        postRow({ postId: "p_2", likeCount: 40, authorId: "u_2" }),
      ],
      media: [
        mediaRow({ id: "m_1", postId: "p_1" }),
        mediaRow({ id: "m_2", postId: "p_2" }),
      ],
      limit: 10,
    });
    expect(result.map((image) => image.postId)).toEqual(["p_2", "p_1"]);
  });

  it("skips a post whose media has gone", () => {
    // Text posts have none, and a moderator removing an image leaves the post.
    const result = assembleImageHighlights({
      posts: [
        postRow({ postId: "p_1", likeCount: 99 }),
        postRow({ postId: "p_2", likeCount: 5, authorId: "u_2" }),
      ],
      media: [mediaRow({ id: "m_2", postId: "p_2" })],
      limit: 10,
    });
    expect(result.map((image) => image.postId)).toEqual(["p_2"]);
  });

  it("carries the alt text and dimensions through", () => {
    const result = assembleImageHighlights({
      posts: [postRow()],
      media: [
        mediaRow({ altText: "Ork nob, freehand checks", width: 8, height: 9 }),
      ],
      limit: 10,
    });
    expect(result[0]!.altText).toBe("Ork nob, freehand checks");
    expect(result[0]!.width).toBe(8);
    expect(result[0]!.height).toBe(9);
  });

  it("stops one painter filling the whole strip", () => {
    const result = assembleImageHighlights({
      posts: [
        postRow({ postId: "p_1", likeCount: 90, authorId: "u_1" }),
        postRow({ postId: "p_2", likeCount: 80, authorId: "u_1" }),
        postRow({ postId: "p_3", likeCount: 70, authorId: "u_1" }),
        postRow({ postId: "p_4", likeCount: 5, authorId: "u_2" }),
      ],
      media: [
        mediaRow({ id: "m_1", postId: "p_1" }),
        mediaRow({ id: "m_2", postId: "p_2" }),
        mediaRow({ id: "m_3", postId: "p_3" }),
        mediaRow({ id: "m_4", postId: "p_4" }),
      ],
      limit: 10,
      maxPerAuthor: 2,
    });
    expect(result.map((image) => image.postId)).toEqual(["p_1", "p_2", "p_4"]);
  });

  it("respects the limit after the per-author cap", () => {
    const result = assembleImageHighlights({
      posts: [
        postRow({ postId: "p_1", likeCount: 90, authorId: "u_1" }),
        postRow({ postId: "p_2", likeCount: 80, authorId: "u_2" }),
        postRow({ postId: "p_3", likeCount: 70, authorId: "u_3" }),
      ],
      media: [
        mediaRow({ id: "m_1", postId: "p_1" }),
        mediaRow({ id: "m_2", postId: "p_2" }),
        mediaRow({ id: "m_3", postId: "p_3" }),
      ],
      limit: 2,
      maxPerAuthor: 2,
    });
    expect(result).toHaveLength(2);
  });
});

describe("capPerAuthor", () => {
  const items = [
    { id: 1, who: "a" },
    { id: 2, who: "b" },
    { id: 3, who: "a" },
    { id: 4, who: "a" },
    { id: 5, who: "c" },
  ];

  it("keeps at most the given number each, in order", () => {
    expect(
      capPerAuthor(items, (item) => item.who, 2).map((item) => item.id),
    ).toEqual([1, 2, 3, 5]);
  });

  it("keeps everything when the cap is high enough", () => {
    expect(capPerAuthor(items, (item) => item.who, 9)).toHaveLength(5);
  });

  it("handles an empty list", () => {
    expect(capPerAuthor([], () => "a", 2)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

function highlightProject(ownerId: string, id: string): HighlightProject {
  return {
    id,
    title: "A build log",
    slug: "a-build-log",
    summary: null,
    coverImageId: null,
    likeTotal: 10,
    postsCounted: 2,
    owner: { userId: ownerId, username: ownerId, displayName: ownerId },
  };
}

function highlightImage(authorId: string, postId: string): HighlightImage {
  return {
    postId,
    mediaId: `m_${postId}`,
    imageId: `img_${postId}`,
    width: null,
    height: null,
    altText: null,
    likeCount: 4,
    author: { userId: authorId, username: authorId, displayName: authorId },
  };
}

describe("authorIdsIn", () => {
  it("collects everyone once across both lists", () => {
    const ids = authorIdsIn({
      projects: [highlightProject("u_1", "pr_1")],
      images: [highlightImage("u_1", "p_1"), highlightImage("u_2", "p_2")],
    });
    expect([...ids].sort()).toEqual(["u_1", "u_2"]);
  });

  it("returns nothing for empty highlights", () => {
    expect(authorIdsIn({ projects: [], images: [] })).toEqual([]);
  });
});

describe("filterHidden", () => {
  const highlights = {
    projects: [highlightProject("u_1", "pr_1"), highlightProject("u_2", "pr_2")],
    images: [highlightImage("u_1", "p_1"), highlightImage("u_2", "p_2")],
  };

  it("removes both the build logs and the photographs of a blocked person", () => {
    const result = filterHidden(highlights, new Set(["u_1"]));
    expect(result.projects.map((entry) => entry.id)).toEqual(["pr_2"]);
    expect(result.images.map((entry) => entry.postId)).toEqual(["p_2"]);
  });

  it("leaves the list alone when the viewer has blocked nobody in it", () => {
    expect(filterHidden(highlights, [])).toBe(highlights);
    expect(filterHidden(highlights, ["u_9"]).images).toHaveLength(2);
  });
});
