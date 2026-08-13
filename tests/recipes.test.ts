import { describe, expect, it } from "vitest";
import {
  canViewRecipe,
  copyStepRows,
  paintQueries,
  stepRows,
  visibleInList,
  type RecipeStepInput,
} from "../server/services/recipes";
import {
  attachRecipeSchema,
  MUTABLE_NOTIFICATION_TYPES,
  recipeSchema,
} from "../server/api/validators";
import { slugify } from "../app/lib/slug";

/*
 * The recipe service is mostly D1 writes, tested end to end elsewhere; what is
 * unit-testable is the assembly the writes hand to the batch — step rows in
 * order, which steps become paint lookups, and which recipes a stranger may
 * see in a listing — plus the validation boundary and the slug fallback.
 */

function step(overrides: Partial<RecipeStepInput> = {}): RecipeStepInput {
  return { technique: "layer", productName: "Mephiston Red", ...overrides };
}

describe("stepRows", () => {
  it("numbers steps by their order and carries the resolved link per step", () => {
    const rows = stepRows(
      "rcp_1",
      [step({ productName: "Wraithbone" }), step({ productName: "Skeleton Horde" })],
      ["https://shop/wraithbone", null],
    );
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]!.shopUrl).toBe("https://shop/wraithbone");
    // A miss (or an unconfigured shop) leaves the paint as plain text.
    expect(rows[1]!.shopUrl).toBeNull();
    expect(rows[0]!.recipeId).toBe("rcp_1");
  });

  it("keeps a pure-technique step, with no product", () => {
    const rows = stepRows(
      "rcp_1",
      [step({ technique: "drybrush", productName: null, note: "torn sponge" })],
      [null],
    );
    expect(rows[0]!.productName).toBeNull();
    expect(rows[0]!.note).toBe("torn sponge");
    expect(rows[0]!.technique).toBe("drybrush");
  });

  it("truncates an over-long product name and note", () => {
    const rows = stepRows(
      "rcp_1",
      [step({ productName: "x".repeat(200), note: "y".repeat(500) })],
      [null],
    );
    expect(rows[0]!.productName!.length).toBe(120);
    expect(rows[0]!.note!.length).toBe(300);
  });
});

describe("paintQueries", () => {
  it("makes a query for a named paint and a null for a technique-only step", () => {
    const queries = paintQueries([
      step({ productName: "Nuln Oil", brand: "Citadel" }),
      step({ productName: null }),
    ]);
    expect(queries[0]).toEqual({ name: "Nuln Oil", brand: "Citadel" });
    expect(queries[1]).toBeNull();
  });
});

describe("visibleInList", () => {
  const rows = [
    { visibility: "public" },
    { visibility: "unlisted" },
    { visibility: "private" },
  ];

  it("shows the owner everything", () => {
    expect(visibleInList(rows, true)).toHaveLength(3);
  });

  it("shows a stranger only the public ones — unlisted stays out of listings", () => {
    expect(visibleInList(rows, false)).toEqual([{ visibility: "public" }]);
  });
});

describe("recipeSchema", () => {
  it("accepts a recipe and defaults steps and visibility", () => {
    const result = recipeSchema.safeParse({ title: "Death Guard rust" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
      expect(result.data.visibility).toBe("public");
    }
  });

  it("rejects an empty title", () => {
    expect(recipeSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects an unknown technique", () => {
    const result = recipeSchema.safeParse({
      title: "x",
      steps: [{ technique: "airbrush-magic" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more steps than the cap", () => {
    const steps = Array.from({ length: 41 }, () => ({ technique: "layer" }));
    expect(recipeSchema.safeParse({ title: "x", steps }).success).toBe(false);
  });

  it("attachRecipeSchema needs a recipe id", () => {
    expect(attachRecipeSchema.safeParse({}).success).toBe(false);
    expect(attachRecipeSchema.safeParse({ recipeId: "rcp_1" }).success).toBe(true);
  });
});

describe("recipe slug fallback", () => {
  it("falls back to 'recipe' when a title has no usable characters", () => {
    expect(slugify("🎨🖌️", "recipe")).toBe("recipe");
    expect(slugify("Death Guard Rust", "recipe")).toBe("death-guard-rust");
  });
});

describe("canViewRecipe", () => {
  it("hides a private recipe from everyone but its owner", () => {
    expect(canViewRecipe("private", false)).toBe(false);
    expect(canViewRecipe("private", true)).toBe(true);
  });

  it("shows public and unlisted to anyone", () => {
    expect(canViewRecipe("public", false)).toBe(true);
    expect(canViewRecipe("unlisted", false)).toBe(true);
  });
});

describe("copyStepRows (fork)", () => {
  it("copies steps in order and preserves the resolved shop links", () => {
    const rows = copyStepRows("rcp_fork", [
      {
        technique: "wash",
        productName: "Nuln Oil",
        brand: "Citadel",
        shopUrl: "https://shop/nuln-oil",
        note: "over the metals",
      },
      {
        technique: "drybrush",
        productName: "Necron Compound",
        brand: null,
        shopUrl: null,
        note: null,
      },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]!.recipeId).toBe("rcp_fork");
    // The paints are the same, so a fork keeps the link without re-resolving.
    expect(rows[0]!.shopUrl).toBe("https://shop/nuln-oil");
    expect(rows[1]!.shopUrl).toBeNull();
  });
});

describe("mutable notification types", () => {
  it("lets a person mute recipe saves and forks but never system", () => {
    expect(MUTABLE_NOTIFICATION_TYPES).toContain("recipe_saved");
    expect(MUTABLE_NOTIFICATION_TYPES).toContain("recipe_forked");
    expect(MUTABLE_NOTIFICATION_TYPES).not.toContain("system");
  });
});
