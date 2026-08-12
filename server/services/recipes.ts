/*
 * Recipes — reusable, shoppable paint schemes (see docs/RECIPES.md).
 *
 * A recipe is owned by a painter, not a post: written once, shown on many
 * posts, and (in a later phase) saved and forked. The flat `post_product` list
 * stays for a quick "paints used" under one photo; this is the documented,
 * reusable version, and its steps resolve to the shop through the same
 * `resolvePaints` engine `post_product` uses.
 *
 * The split with the route mirrors projects: the route resolves the owner,
 * applies the block rule and enforces visibility; this module owns the data and
 * the write batches. Counts are denormalised, updated in the same batch, and
 * decremented with the `max(0, n-1)` floor — the house rule.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import { post, postRecipe, profile, recipe, recipeStep } from "../db/schema";
import { resolvePaints } from "./paints";
import { slugify } from "../../app/lib/slug";
import type { Technique } from "../../app/lib/taxonomy";
import {
  MAX_RECIPE_SUMMARY,
  MAX_RECIPE_TITLE,
  MAX_STEP_NOTE,
  MAX_STEP_PRODUCT_NAME,
} from "../../app/lib/taxonomy";

export type RecipeStepInput = {
  technique: Technique;
  productName?: string | null;
  brand?: string | null;
  note?: string | null;
};

export type RecipeInput = {
  title: string;
  summary?: string | null;
  gameSystem?: string | null;
  scale?: string | null;
  visibility?: "public" | "unlisted" | "private";
  steps: RecipeStepInput[];
};

export type RecipeStepRow = {
  id: string;
  recipeId: string;
  position: number;
  technique: Technique;
  productName: string | null;
  brand: string | null;
  shopUrl: string | null;
  note: string | null;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/* -------------------------------------------------------------------------- */
/* Pure assembly (unit-tested)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build `recipe_step` rows from validated input and the resolved shop links,
 * one link per step by position. A null resolution — a miss, a non-paint step,
 * or an unconfigured shop — just leaves `shopUrl` null and the paint renders as
 * its name.
 */
export function stepRows(
  recipeId: string,
  steps: RecipeStepInput[],
  resolved: (string | null)[],
): RecipeStepRow[] {
  return steps.map((step, index) => ({
    id: newId("rst"),
    recipeId,
    position: index,
    technique: step.technique,
    productName: step.productName?.slice(0, MAX_STEP_PRODUCT_NAME) ?? null,
    brand: step.brand?.slice(0, 60) ?? null,
    shopUrl: resolved[index] ?? null,
    note: step.note?.slice(0, MAX_STEP_NOTE) ?? null,
  }));
}

/**
 * The paint queries for a set of steps: a step with no product name is not a
 * lookup, so it maps to null and `resolvePaints` skips it.
 */
export function paintQueries(
  steps: RecipeStepInput[],
): ({ name: string; brand?: string | null } | null)[] {
  return steps.map((step) =>
    step.productName ? { name: step.productName, brand: step.brand } : null,
  );
}

/** Which recipes a viewer may see in a listing: public only, unless it is theirs. */
export function visibleInList<T extends { visibility: string }>(
  rows: T[],
  isOwner: boolean,
): T[] {
  if (isOwner) return rows;
  return rows.filter((row) => row.visibility === "public");
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createRecipe(
  db: Db,
  ownerId: string,
  input: RecipeInput,
  env?: Env,
): Promise<{ id: string; slug: string }> {
  const id = newId("rcp");
  const slug = await uniqueRecipeSlug(db, ownerId, input.title);

  const resolved = env
    ? await resolvePaints(env, paintQueries(input.steps))
    : input.steps.map(() => null);

  const statements: any[] = [
    db.insert(recipe).values({
      id,
      ownerId,
      slug,
      title: input.title.slice(0, MAX_RECIPE_TITLE),
      summary: input.summary?.slice(0, MAX_RECIPE_SUMMARY) ?? null,
      gameSystem: input.gameSystem ?? null,
      scale: input.scale ?? null,
      visibility: input.visibility ?? "public",
    }),
  ];

  const rows = stepRows(id, input.steps, resolved);
  if (rows.length) statements.push(db.insert(recipeStep).values(rows));

  statements.push(
    db
      .update(profile)
      .set({ recipeCount: sql`${profile.recipeCount} + 1`, updatedAt: nowSeconds() })
      .where(eq(profile.userId, ownerId)),
  );

  await db.batch(statements as [any, ...any[]]);
  return { id, slug };
}

/**
 * Replace a recipe's fields and its whole step list. Returns false if the
 * recipe is not the caller's. The steps are replaced wholesale — the editor
 * sends the full list, and a small delete-then-insert is simpler and cheaper
 * than diffing a handful of rows.
 */
export async function updateRecipe(
  db: Db,
  ownerId: string,
  recipeId: string,
  input: RecipeInput,
  env?: Env,
): Promise<boolean> {
  const owned = await db.query.recipe.findFirst({
    where: and(eq(recipe.id, recipeId), eq(recipe.ownerId, ownerId)),
  });
  if (!owned) return false;

  const resolved = env
    ? await resolvePaints(env, paintQueries(input.steps))
    : input.steps.map(() => null);

  const statements: any[] = [
    db
      .update(recipe)
      .set({
        title: input.title.slice(0, MAX_RECIPE_TITLE),
        summary: input.summary?.slice(0, MAX_RECIPE_SUMMARY) ?? null,
        gameSystem: input.gameSystem ?? null,
        scale: input.scale ?? null,
        visibility: input.visibility ?? "public",
        updatedAt: nowSeconds(),
      })
      .where(eq(recipe.id, recipeId)),
    db.delete(recipeStep).where(eq(recipeStep.recipeId, recipeId)),
  ];

  const rows = stepRows(recipeId, input.steps, resolved);
  if (rows.length) statements.push(db.insert(recipeStep).values(rows));

  await db.batch(statements as [any, ...any[]]);
  return true;
}

export async function deleteRecipe(
  db: Db,
  ownerId: string,
  recipeId: string,
): Promise<boolean> {
  const owned = await db.query.recipe.findFirst({
    where: and(eq(recipe.id, recipeId), eq(recipe.ownerId, ownerId)),
  });
  if (!owned) return false;

  // Steps and post_recipe rows cascade on the foreign keys.
  await db.batch([
    db.delete(recipe).where(eq(recipe.id, recipeId)),
    db
      .update(profile)
      .set({ recipeCount: sql`max(0, ${profile.recipeCount} - 1)` })
      .where(eq(profile.userId, ownerId)),
  ]);
  return true;
}

/**
 * Show a recipe on a post. Both must belong to the caller — you cannot credit
 * your recipe on someone else's post, nor someone else's recipe as if it were
 * yours to attach. Idempotent: attaching twice does not double `use_count`.
 */
export async function attachRecipeToPost(
  db: Db,
  userId: string,
  postId: string,
  recipeId: string,
): Promise<"ok" | "not_found"> {
  const [ownedPost, ownedRecipe, already] = await Promise.all([
    db.query.post.findFirst({ where: and(eq(post.id, postId), eq(post.authorId, userId)) }),
    db.query.recipe.findFirst({ where: and(eq(recipe.id, recipeId), eq(recipe.ownerId, userId)) }),
    db.query.postRecipe.findFirst({
      where: and(eq(postRecipe.postId, postId), eq(postRecipe.recipeId, recipeId)),
    }),
  ]);
  if (!ownedPost || !ownedRecipe) return "not_found";
  if (already) return "ok";

  await db.batch([
    db.insert(postRecipe).values({ postId, recipeId }).onConflictDoNothing(),
    db
      .update(recipe)
      .set({ useCount: sql`${recipe.useCount} + 1` })
      .where(eq(recipe.id, recipeId)),
  ]);
  return "ok";
}

export async function detachRecipeFromPost(
  db: Db,
  userId: string,
  postId: string,
  recipeId: string,
): Promise<"ok" | "not_found"> {
  const link = await db.query.postRecipe.findFirst({
    where: and(eq(postRecipe.postId, postId), eq(postRecipe.recipeId, recipeId)),
  });
  if (!link) return "not_found";

  // Only the post's author may detach; the recipe owner does not get to reach
  // into someone else's post. (Attach already required owning both.)
  const ownedPost = await db.query.post.findFirst({
    where: and(eq(post.id, postId), eq(post.authorId, userId)),
  });
  if (!ownedPost) return "not_found";

  await db.batch([
    db
      .delete(postRecipe)
      .where(and(eq(postRecipe.postId, postId), eq(postRecipe.recipeId, recipeId))),
    db
      .update(recipe)
      .set({ useCount: sql`max(0, ${recipe.useCount} - 1)` })
      .where(eq(recipe.id, recipeId)),
  ]);
  return "ok";
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function findRecipe(db: Db, ownerId: string, slug: string) {
  return db.query.recipe.findFirst({
    where: and(eq(recipe.ownerId, ownerId), eq(recipe.slug, slug)),
  });
}

/** A recipe and its steps in order. Null if the recipe is gone. */
export async function getRecipeWithSteps(db: Db, recipeId: string) {
  const found = await db.query.recipe.findFirst({ where: eq(recipe.id, recipeId) });
  if (!found) return null;

  const steps = await db
    .select()
    .from(recipeStep)
    .where(eq(recipeStep.recipeId, recipeId))
    .orderBy(recipeStep.position);

  return { recipe: found, steps };
}

/**
 * A painter's recipes, newest edit first. Mirrors the project list: a bounded
 * page rather than a cursor, because a person's own recipe count is small and
 * the list is a shelf, not a feed. Visibility is filtered by `visibleInList`.
 */
export async function listRecipesByOwner(
  db: Db,
  ownerId: string,
  isOwner: boolean,
) {
  const rows = await db
    .select()
    .from(recipe)
    .where(eq(recipe.ownerId, ownerId))
    .orderBy(desc(recipe.updatedAt))
    .limit(100);
  return visibleInList(rows, isOwner);
}

/** The recipes attached to a post, for the "paints used" strip on a post page. */
export async function getPostRecipes(db: Db, postId: string) {
  const links = await db
    .select({ recipeId: postRecipe.recipeId })
    .from(postRecipe)
    .where(eq(postRecipe.postId, postId));
  if (!links.length) return [];

  const ids = links.map((link) => link.recipeId);
  const recipes = await db.select().from(recipe).where(inArray(recipe.id, ids));
  const steps = await db
    .select()
    .from(recipeStep)
    .where(inArray(recipeStep.recipeId, ids))
    .orderBy(recipeStep.position);

  return recipes.map((row) => ({
    recipe: row,
    steps: steps.filter((step) => step.recipeId === row.id),
  }));
}

async function uniqueRecipeSlug(db: Db, ownerId: string, title: string) {
  const base = slugify(title, "recipe");
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.query.recipe.findFirst({
      where: and(eq(recipe.ownerId, ownerId), eq(recipe.slug, candidate)),
    });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
