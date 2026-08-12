import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  fieldErrors,
  pushDelivery,
  requireAuth,
  type ApiEnv,
} from "../context";
import type { Db } from "../../db/client";
import { block, profile, recipe } from "../../db/schema";
import {
  attachRecipeSchema,
  recipePatchSchema,
  recipeSchema,
} from "../validators";
import {
  attachRecipeToPost,
  createRecipe,
  deleteRecipe,
  detachRecipeFromPost,
  findRecipe,
  forkRecipe,
  getRecipeWithSteps,
  listRecipesByOwner,
  saveRecipe,
  unsaveRecipe,
  updateRecipe,
} from "../../services/recipes";

/*
 * Recipes: the reusable paint schemes at /@user/recipes/:slug.
 *
 * The path shapes follow the project routes deliberately. Reads hang off the
 * username/slug form the page URLs use, listing off /profiles/:username/recipes
 * beside the projects list, and owner-only writes address the recipe by id — so
 * a three-segment GET is never ambiguous with the two-segment create.
 */
export const recipes = new Hono<ApiEnv>();

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** A painter's recipes. Public ones to anyone; all of them to the owner. */
recipes.get("/profiles/:username/recipes", async (c) => {
  const db = c.get("db");
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username").toLowerCase()}`,
  });
  if (!owner || owner.status === "deleted") {
    throw apiError(404, "not_found", "No such painter.");
  }

  const isOwner = c.get("user")?.id === owner.userId;
  const rows = await listRecipesByOwner(db, owner.userId, isOwner);
  return c.json({ recipes: rows });
});

/** One recipe with its steps, by owner and slug. */
recipes.get("/recipes/:username/:slug", async (c) => {
  const db = c.get("db");
  const viewerId = c.get("user")?.id ?? null;
  const found = await loadVisibleRecipe(
    db,
    c.req.param("username"),
    c.req.param("slug"),
    viewerId,
  );

  const full = await getRecipeWithSteps(db, found.recipe.id);
  if (!full) throw apiError(404, "not_found", "No such recipe.");

  return c.json({ recipe: full.recipe, steps: full.steps, owner: found.owner });
});

/* -------------------------------------------------------------------------- */
/* Writes (owner only)                                                        */
/* -------------------------------------------------------------------------- */

recipes.post("/recipes", requireAuth, async (c) => {
  const parsed = recipeSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the recipe.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const created = await createRecipe(
    c.get("db"),
    c.get("user")!.id,
    parsed.data,
    c.env,
  );
  return c.json(created, 201);
});

recipes.patch("/recipes/:id", requireAuth, async (c) => {
  const parsed = recipePatchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the recipe.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const ok = await updateRecipe(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("id"),
    parsed.data,
    c.env,
  );
  if (!ok) throw apiError(404, "not_found", "That recipe is not yours.");
  return c.json({ ok: true });
});

recipes.delete("/recipes/:id", requireAuth, async (c) => {
  const ok = await deleteRecipe(c.get("db"), c.get("user")!.id, c.req.param("id"));
  if (!ok) throw apiError(404, "not_found", "That recipe is not yours.");
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Save and fork                                                              */
/* -------------------------------------------------------------------------- */

recipes.post("/recipes/:id/save", requireAuth, async (c) => {
  const result = await saveRecipe(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("id"),
    pushDelivery(c),
  );
  if (result === "not_found") {
    throw apiError(404, "not_found", "No such recipe.");
  }
  return c.json({ ok: true, saved: true });
});

recipes.delete("/recipes/:id/save", requireAuth, async (c) => {
  const result = await unsaveRecipe(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("id"),
  );
  if (result === "not_found") {
    throw apiError(404, "not_found", "That recipe was not saved.");
  }
  return c.json({ ok: true, saved: false });
});

recipes.post("/recipes/:id/fork", requireAuth, async (c) => {
  const result = await forkRecipe(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("id"),
    pushDelivery(c),
  );
  if (result === "not_found") {
    throw apiError(404, "not_found", "No such recipe.");
  }
  return c.json(result, 201);
});

/* -------------------------------------------------------------------------- */
/* Attach to a post                                                           */
/* -------------------------------------------------------------------------- */

recipes.post("/posts/:postId/recipe", requireAuth, async (c) => {
  const parsed = attachRecipeSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Pick a recipe.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const result = await attachRecipeToPost(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("postId"),
    parsed.data.recipeId,
  );
  if (result === "not_found") {
    throw apiError(404, "not_found", "That post or recipe is not yours.");
  }
  return c.json({ ok: true });
});

recipes.delete("/posts/:postId/recipe/:recipeId", requireAuth, async (c) => {
  const result = await detachRecipeFromPost(
    c.get("db"),
    c.get("user")!.id,
    c.req.param("postId"),
    c.req.param("recipeId"),
  );
  if (result === "not_found") {
    throw apiError(404, "not_found", "That recipe is not on that post.");
  }
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Lookup with the block rule                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A recipe by owner and slug, with the block rule and visibility the page
 * applies. A private recipe is the owner's alone; unlisted is reachable by
 * anyone with the link but kept out of the listing. Every "no" is a 404, so a
 * block or a private recipe is never announced by the response.
 */
async function loadVisibleRecipe(
  db: Db,
  username: string,
  slug: string,
  viewerId: string | null,
) {
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!owner || owner.status === "deleted") {
    throw apiError(404, "not_found", "No such painter.");
  }

  if (viewerId && viewerId !== owner.userId) {
    const blocked = await db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${owner.userId})
            or (${block.blockerId} = ${owner.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) throw apiError(404, "not_found", "No such recipe.");
  }

  const found = await findRecipe(db, owner.userId, slug);
  if (!found) throw apiError(404, "not_found", "No such recipe.");

  if (found.visibility === "private" && viewerId !== owner.userId) {
    throw apiError(404, "not_found", "No such recipe.");
  }

  return { recipe: found, owner };
}
