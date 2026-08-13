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

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import {
  post,
  postRecipe,
  profile,
  recipe,
  recipeSave,
  recipeStep,
} from "../db/schema";
import { capPerAuthor } from "./highlights";
import { blockedUserIds } from "./moderation";
import { resolvePaints } from "./paints";
import { createNotification } from "./posts";
import type { PushDelivery } from "./push";
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

/**
 * The recipes attached to a post, for the "paints used" strip on a post page.
 *
 * A `private` recipe is the owner's alone even when attached: attaching is a
 * deliberate act, but "only you" has to keep meaning that, so a private recipe
 * is hidden from everyone but its owner. `includePrivate` is set only when the
 * viewer is the post's author (who is also the recipe's owner — attach requires
 * owning both). Unlisted is shown, matching its "anyone with the link" meaning.
 */
export async function getPostRecipes(
  db: Db,
  postId: string,
  options: { includePrivate?: boolean } = {},
) {
  const links = await db
    .select({ recipeId: postRecipe.recipeId })
    .from(postRecipe)
    .where(eq(postRecipe.postId, postId));
  if (!links.length) return [];

  const ids = links.map((link) => link.recipeId);
  const found = await db.select().from(recipe).where(inArray(recipe.id, ids));
  const recipes = options.includePrivate
    ? found
    : found.filter((row) => row.visibility !== "private");
  if (!recipes.length) return [];

  const visibleIds = recipes.map((row) => row.id);
  const steps = await db
    .select()
    .from(recipeStep)
    .where(inArray(recipeStep.recipeId, visibleIds))
    .orderBy(recipeStep.position);

  return recipes.map((row) => ({
    recipe: row,
    steps: steps.filter((step) => step.recipeId === row.id),
  }));
}

/* -------------------------------------------------------------------------- */
/* Save and fork                                                              */
/* -------------------------------------------------------------------------- */

/** A private recipe is viewable only by its owner; public and unlisted are open. */
export function canViewRecipe(visibility: string, isOwner: boolean): boolean {
  return isOwner || visibility !== "private";
}

/**
 * Copy a recipe's steps into rows for a fork, preserving the resolved shop
 * links — the paints are the same, so there is nothing to look up again.
 */
export function copyStepRows(
  recipeId: string,
  steps: {
    technique: string;
    productName: string | null;
    brand: string | null;
    shopUrl: string | null;
    note: string | null;
  }[],
): RecipeStepRow[] {
  return steps.map((step, index) => ({
    id: newId("rst"),
    recipeId,
    position: index,
    technique: step.technique as Technique,
    productName: step.productName,
    brand: step.brand,
    shopUrl: step.shopUrl,
    note: step.note,
  }));
}

/** Keep a recipe in your collection. Idempotent; notifies the owner. */
export async function saveRecipe(
  db: Db,
  userId: string,
  recipeId: string,
  delivery?: PushDelivery,
): Promise<"ok" | "not_found"> {
  const target = await db.query.recipe.findFirst({ where: eq(recipe.id, recipeId) });
  if (!target || !canViewRecipe(target.visibility, target.ownerId === userId)) {
    return "not_found";
  }

  const already = await db.query.recipeSave.findFirst({
    where: and(eq(recipeSave.recipeId, recipeId), eq(recipeSave.userId, userId)),
  });
  if (already) return "ok";

  await db.batch([
    db.insert(recipeSave).values({ recipeId, userId }).onConflictDoNothing(),
    db
      .update(recipe)
      .set({ saveCount: sql`${recipe.saveCount} + 1` })
      .where(eq(recipe.id, recipeId)),
  ]);

  if (target.ownerId !== userId) {
    await createNotification(
      db,
      {
        userId: target.ownerId,
        actorId: userId,
        type: "recipe_saved",
        subjectType: "recipe",
        subjectId: recipeId,
        preview: target.title,
      },
      delivery,
    );
  }
  return "ok";
}

export async function unsaveRecipe(
  db: Db,
  userId: string,
  recipeId: string,
): Promise<"ok" | "not_found"> {
  const saved = await db.query.recipeSave.findFirst({
    where: and(eq(recipeSave.recipeId, recipeId), eq(recipeSave.userId, userId)),
  });
  if (!saved) return "not_found";

  await db.batch([
    db
      .delete(recipeSave)
      .where(and(eq(recipeSave.recipeId, recipeId), eq(recipeSave.userId, userId))),
    db
      .update(recipe)
      .set({ saveCount: sql`max(0, ${recipe.saveCount} - 1)` })
      .where(eq(recipe.id, recipeId)),
  ]);
  return "ok";
}

/**
 * Copy a recipe into one the forker owns and can edit, crediting the original
 * via `forkedFromId`. The new recipe is public by default — the forker's own
 * version, which they can then change. Notifies the original author.
 */
export async function forkRecipe(
  db: Db,
  userId: string,
  recipeId: string,
  delivery?: PushDelivery,
): Promise<{ id: string; slug: string } | "not_found"> {
  const origin = await getRecipeWithSteps(db, recipeId);
  if (
    !origin ||
    !canViewRecipe(origin.recipe.visibility, origin.recipe.ownerId === userId)
  ) {
    return "not_found";
  }

  const id = newId("rcp");
  const slug = await uniqueRecipeSlug(db, userId, origin.recipe.title);

  const statements: any[] = [
    db.insert(recipe).values({
      id,
      ownerId: userId,
      slug,
      title: origin.recipe.title,
      summary: origin.recipe.summary,
      gameSystem: origin.recipe.gameSystem,
      scale: origin.recipe.scale,
      visibility: "public",
      forkedFromId: origin.recipe.id,
    }),
  ];

  const rows = copyStepRows(id, origin.steps);
  if (rows.length) statements.push(db.insert(recipeStep).values(rows));

  statements.push(
    db
      .update(profile)
      .set({ recipeCount: sql`${profile.recipeCount} + 1`, updatedAt: nowSeconds() })
      .where(eq(profile.userId, userId)),
    db
      .update(recipe)
      .set({ forkCount: sql`${recipe.forkCount} + 1` })
      .where(eq(recipe.id, origin.recipe.id)),
  );

  await db.batch(statements as [any, ...any[]]);

  if (origin.recipe.ownerId !== userId) {
    await createNotification(
      db,
      {
        userId: origin.recipe.ownerId,
        actorId: userId,
        type: "recipe_forked",
        subjectType: "recipe",
        subjectId: origin.recipe.id,
        preview: origin.recipe.title,
      },
      delivery,
    );
  }
  return { id, slug };
}

/**
 * A person's saved recipes, newest save first, with the owner for the link.
 * A recipe that has since gone private (and is not the viewer's) drops off.
 */
export async function listSavedRecipes(db: Db, userId: string) {
  const rows = await db
    .select({
      id: recipe.id,
      slug: recipe.slug,
      title: recipe.title,
      visibility: recipe.visibility,
      ownerId: recipe.ownerId,
      ownerUsername: profile.username,
      ownerDisplayName: profile.displayName,
      savedAt: recipeSave.createdAt,
    })
    .from(recipeSave)
    .innerJoin(recipe, eq(recipe.id, recipeSave.recipeId))
    .innerJoin(profile, eq(profile.userId, recipe.ownerId))
    .where(eq(recipeSave.userId, userId))
    .orderBy(desc(recipeSave.createdAt))
    .limit(100);

  return rows.filter((row) =>
    canViewRecipe(row.visibility, row.ownerId === userId),
  );
}

/* -------------------------------------------------------------------------- */
/* Discovery — popular recipes                                                */
/* -------------------------------------------------------------------------- */

export const POPULAR_RECIPES_CACHE_KEY = "popular_recipes:v1";
export const POPULAR_RECIPES_TTL_SECONDS = 15 * 60;
/** How many are shown, and how many are cached so the block filter stays free. */
const SHOWN_RECIPES = 6;
const CANDIDATE_RECIPES = 18;
const MAX_RECIPES_PER_AUTHOR = 2;

type PopularCandidate = {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  saveCount: number;
  forkCount: number;
};

export type PopularRecipe = Omit<PopularCandidate, "ownerId">;

/**
 * The most kept-and-adapted public recipes, computed into KV every fifteen
 * minutes — the same shape as the homepage highlights, and a published rule
 * (save + fork), not an opaque ranking. The cache holds a surplus so a viewer's
 * blocks and mutes can be applied to a short list afterwards, and it is capped
 * per author so one popular painter cannot become the whole strip.
 */
export async function getPopularRecipes(
  env: Env,
  db: Db,
  options: {
    viewerId?: string | null;
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
): Promise<PopularRecipe[]> {
  try {
    let candidates = await readPopularCache(env);
    if (!candidates) {
      candidates = await computePopularRecipes(db);
      const write = env.CACHE.put(
        POPULAR_RECIPES_CACHE_KEY,
        JSON.stringify(candidates),
        { expirationTtl: POPULAR_RECIPES_TTL_SECONDS },
      );
      if (options.waitUntil) options.waitUntil(write);
      else await write;
    }

    const hidden = options.viewerId
      ? new Set(await blockedUserIds(db, options.viewerId))
      : new Set<string>();

    const visible = hidden.size
      ? candidates.filter((row) => !hidden.has(row.ownerId))
      : candidates;

    return capPerAuthor(visible, (row) => row.ownerId, MAX_RECIPES_PER_AUTHOR)
      .slice(0, SHOWN_RECIPES)
      .map(({ ownerId: _ownerId, ...rest }) => rest);
  } catch {
    // A missing strip is a much smaller problem than a page that will not render.
    return [];
  }
}

async function readPopularCache(env: Env): Promise<PopularCandidate[] | null> {
  const cached = await env.CACHE.get(POPULAR_RECIPES_CACHE_KEY, "json");
  return Array.isArray(cached) ? (cached as PopularCandidate[]) : null;
}

async function computePopularRecipes(db: Db): Promise<PopularCandidate[]> {
  const score = sql<number>`${recipe.saveCount} + ${recipe.forkCount}`;
  return db
    .select({
      id: recipe.id,
      slug: recipe.slug,
      title: recipe.title,
      ownerId: recipe.ownerId,
      ownerUsername: profile.username,
      ownerDisplayName: profile.displayName,
      saveCount: recipe.saveCount,
      forkCount: recipe.forkCount,
    })
    .from(recipe)
    .innerJoin(profile, eq(profile.userId, recipe.ownerId))
    .where(
      and(
        eq(recipe.visibility, "public"),
        eq(profile.status, "active"),
        gt(score, 0),
      ),
    )
    .orderBy(desc(score), desc(recipe.id))
    .limit(CANDIDATE_RECIPES);
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
