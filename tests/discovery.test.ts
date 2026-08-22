import { describe, expect, it } from "vitest";
import {
  assembleTopCreators,
  bestSampleByAuthor,
  creatorScore,
  type CreatorAggregateRow,
  type CreatorSampleRow,
} from "../server/services/discovery";

/*
 * The SQL rules — public only, published only, active authors, inside the
 * window — live in the query and are not reachable here. What is testable is
 * the published formula and the assembly after the rows come back: how the
 * score weights consistency, and which rows survive.
 */

function row(overrides: Partial<CreatorAggregateRow> = {}): CreatorAggregateRow {
  return {
    userId: "u_1",
    username: "graham",
    displayName: "Graham",
    avatarImageId: null,
    bio: null,
    followerCount: 0,
    engagement: 10,
    postsCounted: 2,
    weeksActive: 1,
    ...overrides,
  };
}

describe("creatorScore", () => {
  it("is just the engagement when active a single week", () => {
    // 1 week → 1 + 0.15 = 1.15 multiplier (floating point, so close-to).
    expect(creatorScore({ engagement: 100, weeksActive: 1 })).toBeCloseTo(115);
  });

  it("lifts steady contributors, capped at six weeks", () => {
    const spread = creatorScore({ engagement: 100, weeksActive: 6 });
    const burst = creatorScore({ engagement: 100, weeksActive: 1 });
    expect(spread).toBeGreaterThan(burst);
    // Beyond the cap it stops climbing — no reward for gaming the counter.
    expect(creatorScore({ engagement: 100, weeksActive: 20 })).toBe(spread);
  });

  it("never punishes a quiet window below cost of a single good post", () => {
    // A high-engagement burst still beats a low-engagement steady presence.
    const burst = creatorScore({ engagement: 500, weeksActive: 1 });
    const steady = creatorScore({ engagement: 100, weeksActive: 6 });
    expect(burst).toBeGreaterThan(steady);
  });

  it("treats zero or negative weeks as no bonus", () => {
    expect(creatorScore({ engagement: 50, weeksActive: 0 })).toBe(50);
    expect(creatorScore({ engagement: 50, weeksActive: -3 })).toBe(50);
  });
});

describe("assembleTopCreators", () => {
  it("drops creators whose recent work earned nothing", () => {
    const out = assembleTopCreators(
      [
        row({ userId: "u_1", engagement: 40 }),
        row({ userId: "u_2", engagement: 0 }),
        row({ userId: "u_3", engagement: null }),
      ],
      10,
    );
    expect(out.map((c) => c.userId)).toEqual(["u_1"]);
  });

  it("orders by score, so consistency can overtake a bigger single burst", () => {
    const out = assembleTopCreators(
      [
        row({ userId: "burst", engagement: 100, weeksActive: 1 }), // 115
        row({ userId: "steady", engagement: 90, weeksActive: 6 }), // 90*1.9 = 171
      ],
      10,
    );
    expect(out[0]!.userId).toBe("steady");
    expect(out[1]!.userId).toBe("burst");
  });

  it("breaks ties by id so the order is stable", () => {
    const out = assembleTopCreators(
      [
        row({ userId: "u_b", engagement: 50, weeksActive: 1 }),
        row({ userId: "u_a", engagement: 50, weeksActive: 1 }),
      ],
      10,
    );
    expect(out.map((c) => c.userId)).toEqual(["u_a", "u_b"]);
  });

  it("caps the list at the requested size", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ userId: `u_${i}`, engagement: 100 - i }),
    );
    expect(assembleTopCreators(rows, 8)).toHaveLength(8);
  });

  it("coerces string aggregates from SQLite", () => {
    const out = assembleTopCreators(
      [
        row({
          engagement: "30" as unknown as number,
          weeksActive: "2" as unknown as number,
          postsCounted: "4" as unknown as number,
        }),
      ],
      10,
    );
    expect(out[0]!.engagement).toBe(30);
    expect(out[0]!.weeksActive).toBe(2);
    expect(out[0]!.postsCounted).toBe(4);
    expect(out[0]!.score).toBe(creatorScore({ engagement: 30, weeksActive: 2 }));
  });
});

describe("bestSampleByAuthor", () => {
  function sample(overrides: Partial<CreatorSampleRow> = {}): CreatorSampleRow {
    return { authorId: "u_1", imageId: "img_1", position: 0, createdAt: 100, ...overrides };
  }

  it("keeps the newest photo per author", () => {
    const map = bestSampleByAuthor([
      sample({ imageId: "old", createdAt: 100 }),
      sample({ imageId: "new", createdAt: 200 }),
    ]);
    expect(map.get("u_1")).toBe("new");
  });

  it("breaks a same-time tie by the earlier position", () => {
    const map = bestSampleByAuthor([
      sample({ imageId: "second", createdAt: 200, position: 1 }),
      sample({ imageId: "first", createdAt: 200, position: 0 }),
    ]);
    expect(map.get("u_1")).toBe("first");
  });

  it("holds one entry per author", () => {
    const map = bestSampleByAuthor([
      sample({ authorId: "u_1", imageId: "a" }),
      sample({ authorId: "u_2", imageId: "b" }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("u_2")).toBe("b");
  });
});
