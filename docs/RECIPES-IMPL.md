# Recipes: implementation spec (phase 1)

Build-ready spec for the first two rungs of the `docs/RECIPES.md` build order:

1. **`paints.ts`** — paint-name → shop-URL resolution (roadmap item 3), wired
   into the *existing* `post_product` write so it ships value before a recipe
   exists.
2. **The recipe object** — `recipe` + `recipe_step`, the owner's create/edit
   flow, the public page, and attaching a recipe to a post (`post_recipe`).

Out of scope here, deferred to a phase-2 spec: `recipe_save`, forking, the
popular-recipes discovery strip, the `HowTo` structured data, and the
`recipe_saved`/`recipe_forked` notifications. This spec stops at "a painter can
write a recipe, it resolves to the shop, and a post can show it".

Everything below follows the conventions already in the tree — cite files as you
build against them.

## New configuration

Two new values, following the `CF_*` secret pattern in `wrangler.jsonc` and the
`isConfigured` degradation in `server/services/media.ts`. Resolution is against
the Loaded Dice storefront (`orcs-bazaar.myshopify.com` / `www.loadeddice.uk`)
via the **Shopify Storefront API** (a public, read-only GraphQL endpoint — not
the Admin API, so the token is low-risk).

```
SHOP_STOREFRONT_DOMAIN   var    — e.g. www.loadeddice.uk (the myshopify or custom domain)
SHOP_STOREFRONT_TOKEN    secret — a Storefront API access token, read-only
```

Add both to the `Env` type (wherever `CF_API_TOKEN` et al. are declared) and to
`wrangler.jsonc`'s documented secrets block. **With either unset, resolution is a
no-op that returns `null`** — exactly as `imageUrl` returns `null` when
`CF_IMAGES_ACCOUNT_HASH` is absent — so local dev and any un-provisioned
environment keep working and every paint just renders as plain text, which is the
behaviour today.

## Files touched

| File | Change |
| --- | --- |
| `server/services/paints.ts` | **New.** The resolver + KV cache. |
| `server/services/posts.ts` | Resolve products in `createPost` before the batch. |
| `server/db/schema.ts` | **New tables** `recipe`, `recipe_step`, `post_recipe`; new counters. |
| `app/lib/taxonomy.ts` | **New** `TECHNIQUES` vocabulary + labels; recipe size limits. |
| `server/services/recipes.ts` | **New.** Create / update / get / list-by-owner. |
| `server/api/routes/recipes.ts` | **New** Hono route group. |
| `server/api/index.ts` | Register `api.route("/v1", recipes)`. |
| `server/validation/*` (wherever the Zod lives) | `recipeInput` / `recipeStepInput`. |
| `app/lib/data.server.ts` | Bridge exports for the loader path. |
| `app/routes.ts` + `app/routes/recipe*.tsx` | The public page + create/edit. |
| `migrations/000X_*.sql` | Generated, additive. |
| `tests/*.test.ts` | Resolver, degradation, recipe service, Zod. |

---

## 1. `server/services/paints.ts`

Mirrors `media.ts`: a guarded external call, a typed no-op when unconfigured, and
here a KV layer because the catalogue changes slowly and the same paint names
recur constantly.

### Signature

```ts
/** Resolve one paint name to a Loaded Dice product URL, or null if unmatched. */
export async function resolvePaint(
  env: Env,
  input: { name: string; brand?: string | null },
): Promise<string | null>;

/** Resolve many at once, order-preserving, each independent and failure-isolated. */
export async function resolvePaints(
  env: Env,
  inputs: { name: string; brand?: string | null }[],
): Promise<(string | null)[]>;
```

### Behaviour, in order

1. **Config guard.** If `SHOP_STOREFRONT_DOMAIN` or `SHOP_STOREFRONT_TOKEN` is
   empty, return `null` immediately. No fetch, no cache read. (Reuse/extend the
   `isConfigured` helper from `app/lib/media.ts`.)
2. **Cache key.** Normalise: lowercase, trim, collapse whitespace, strip a
   leading brand if it duplicates `brand`. Key `paint:v1:{brandSlug}:{nameSlug}`.
   The `v1` lets a matching-logic change invalidate rather than migrate, exactly
   like `HIGHLIGHTS_CACHE_KEY`.
3. **Cache read** from `env.CACHE`. Store **both hits and misses** — a resolved
   URL string, or the sentinel `""` for "looked, found nothing". A miss is cached
   so an unknown paint (there will be many — Vallejo names, custom mixes) is not
   re-queried on every post.
   - Hit TTL: 7 days. Miss TTL: 1 day (a paint added to the shop later should
     resolve without a week's wait).
4. **Storefront query** on a cache miss: a Storefront `products(query:)` GraphQL
   call for the name, take the best title match, return its `onlineStoreUrl` (or
   build `https://{domain}/products/{handle}`). Written like `cfFetch` — one
   private `storefrontFetch<T>(env, query, variables)` helper holding the
   endpoint (`https://{domain}/api/2024-01/graphql.json`), the
   `X-Shopify-Storefront-Access-Token` header, and the error mapping.
5. **Never throw into the caller.** Any network/parse error is caught, logged
   once (like the push fan-out), and returns `null`. A failed lookup must never
   fail a post or a recipe — resolution is upside, not a dependency.

### Matching

Keep it boring and legible, not clever: exact-ish title match after
normalisation, brand as a tiebreaker/filter when present. A published, simple
rule beats a fuzzy scorer nobody can reason about — the same instinct as Discover
being one readable formula. Note in a comment that the match is deliberately
conservative: a wrong link in the "paints used" strip is worse than no link.

### `resolvePaints`

`Promise.all` over `resolvePaint`, bounded by the callers' own caps (≤20 products
per post, ≤ the recipe step cap). Each element resolves independently so one
miss/error never nulls the rest.

---

## 2. Wire resolution into the existing `post_product` write

In `server/services/posts.ts`, `createPost` already maps `input.products` into
`postProduct` rows (lines 167–181) and passes `shopUrl` straight through. Insert
resolution just before building that statement:

```ts
if (input.products?.length) {
  const capped = input.products.slice(0, 20);
  // Resolve only those the client did not already resolve. Failure-isolated,
  // never throws, degrades to the plain name.
  const resolved = await resolvePaints(
    env,
    capped.map((p) => ({ name: p.name, brand: p.brand })),
  );
  statements.push(
    db.insert(postProduct).values(
      capped.map((product, index) => ({
        id: newId("pp"),
        postId: id,
        position: index,
        kind: product.kind ?? ("paint" as const),
        name: product.name.slice(0, 120),
        brand: product.brand?.slice(0, 60) ?? null,
        shopUrl: product.shopUrl ?? resolved[index] ?? null,
      })),
    ),
  );
}
```

`createPost` gains an `env` argument (it is already `async` and already awaits
`upsertTags`). The API route that calls it holds `c.env`; pass it through. This
is the same "thread `env` where the caller has it" move `createNotification` uses
for push. **Resolve only `paint`-kind products**, not kits/tools, to keep the
lookups meaningful and cheap.

This step alone closes roadmap item 3: `shop_url` stops being stored-but-empty
and the "quiet commercial layer" starts earning, with zero recipe UI shipped yet.

---

## 3. Schema additions (`server/db/schema.ts`)

All additive. Ids use the existing `newId(prefix)` scheme (`rcp`, `rst`).
Counters are denormalised, updated in the write batch, `max(0, n-1)` on
decrement — the house rule.

```ts
export const recipe = sqliteTable(
  "recipe",
  {
    id: text("id").primaryKey(),                               // rcp_…
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    gameSystem: text("game_system"),
    scale: text("scale"),
    coverImageId: text("cover_image_id"),
    visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
      .notNull().default("public"),
    forkedFromId: text("forked_from_id"),                      // no FK: see note
    saveCount: integer("save_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("recipe_owner_slug_idx").on(t.ownerId, t.slug), // slug unique per owner, like project
    index("recipe_owner_idx").on(t.ownerId, t.createdAt),
    index("recipe_system_idx").on(t.gameSystem, t.createdAt),
  ],
);

export const recipeStep = sqliteTable(
  "recipe_step",
  {
    id: text("id").primaryKey(),                               // rst_…
    recipeId: text("recipe_id").notNull().references(() => recipe.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    technique: text("technique", { enum: TECHNIQUES }).notNull(),
    productName: text("product_name"),
    brand: text("brand"),
    shopUrl: text("shop_url"),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("recipe_step_recipe_idx").on(t.recipeId, t.position)],
);

export const postRecipe = sqliteTable(
  "post_recipe",
  {
    postId: text("post_id").notNull().references(() => post.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id").notNull().references(() => recipe.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.postId, t.recipeId] })],
);
```

Notes that matter:

- **`forkedFromId` carries no FK on purpose**, the same call `project.pinnedPostId`
  makes (`schema.ts` explains it): a forked recipe must survive its origin being
  deleted, showing a degraded "forked from a deleted recipe" credit rather than
  cascading away. Phase 2 uses it; phase 1 just declares it so the column exists.
- **`technique` enum reuses the `TECHNIQUES` const** imported from taxonomy — but
  note the same inversion the schema already lives with: the *enum values* are the
  const, the Zod validators import from taxonomy, the schema imports the tuple.
  If importing a value tuple into `schema.ts` is awkward, inline the literal tuple
  here and keep taxonomy as the source the validators use — match whatever
  `post.wipStage` does today.
- **`profile.recipeCount`** (new denormalised column) is added the same way the
  other profile counters are, incremented in the create batch.

---

## 4. Taxonomy (`app/lib/taxonomy.ts`)

Add beside `WIP_STAGES`, keeping the file dependency-free:

```ts
export const TECHNIQUES = [
  "prime", "base", "layer", "wash", "shade", "drybrush",
  "edge_highlight", "glaze", "wet_blend", "weathering", "other",
] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const TECHNIQUE_LABELS: Record<Technique, string> = { /* "Edge highlight", … */ };

export const MAX_STEPS_PER_RECIPE = 40;
export const MAX_RECIPE_TITLE = 120;
export const MAX_STEP_NOTE = 300;
```

---

## 5. Validation (Zod, wherever the server schemas live)

Import lists from taxonomy, never the reverse (the architecture rule). Mirror the
`CreatePostInput` shape and its caps:

```ts
const recipeStepInput = z.object({
  technique: z.enum(TECHNIQUES),
  productName: z.string().max(120).nullish(),
  brand: z.string().max(60).nullish(),
  note: z.string().max(MAX_STEP_NOTE).nullish(),
});

export const recipeInput = z.object({
  title: z.string().min(1).max(MAX_RECIPE_TITLE),
  summary: z.string().max(300).nullish(),
  gameSystem: z.enum(GAME_SYSTEMS).nullish(),
  scale: z.enum(SCALES).nullish(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  steps: z.array(recipeStepInput).max(MAX_STEPS_PER_RECIPE),
});
```

---

## 6. `server/services/recipes.ts`

Same shape as `posts.ts`: functions take `db` (and `env` where resolution is
needed), build a `statements: any[]`, one `db.batch()`.

- **`createRecipe(db, env, ownerId, input)`**
  1. `slug` from the title (slugify, dedupe against the owner's existing slugs —
     reuse the project slug helper if one exists, else a small local one).
  2. `resolvePaints(env, steps)` for the steps that name a paint; store the
     resolved `shopUrl` per step.
  3. Batch: insert `recipe`, insert `recipe_step[]`, `profile.recipeCount + 1`.
  4. Return `{ id, slug }`.
- **`updateRecipe(db, env, ownerId, recipeId, input)`** — ownership check, then
  replace steps wholesale (delete-all + re-insert in one batch is simplest and
  the step count is tiny; re-resolve paints on save). Bump `updatedAt`.
- **`getRecipe(db, { ownerUsername, slug, viewerId })`** — join owner profile,
  load steps ordered by `position`, enforce `visibility` (private → owner only,
  unlisted → anyone with the link but excluded from listings). Apply the standard
  `hiddenAmong`/block check on the owner, as every other content read does.
- **`listRecipesByOwner(db, ownerId, cursor)`** — keyset on `id` (the id scheme
  gives creation order for free), the same pagination as every list.
- **`attachRecipeToPost(db, postId, recipeId, authorId)`** — ownership check on
  both, insert `post_recipe` `onConflictDoNothing`, `recipe.useCount + 1` in the
  same batch. **Detach** mirrors it with `max(0, useCount - 1)`.

Deletion: `deleteRecipe` cascades steps and `post_recipe` via the FKs;
`profile.recipeCount` decremented with the `max(0, n-1)` floor in the same batch,
exactly as `deletePost` gives back the project count.

---

## 7. API routes (`server/api/routes/recipes.ts`)

A Hono group like `people`/`projects`, registered with
`api.route("/v1", recipes)` in `server/api/index.ts`. Auth via the existing
`requireAuth` middleware for writes; reads are public subject to `visibility`.

```
GET    /v1/recipes/:username/:slug     — one recipe (visibility-enforced)
GET    /v1/recipes?owner=:username     — a person's recipes, keyset paginated
POST   /v1/recipes                     — create        (requireAuth, recipeInput)
PATCH  /v1/recipes/:id                 — update        (requireAuth, owner-only)
DELETE /v1/recipes/:id                 — delete        (requireAuth, owner-only)
POST   /v1/posts/:postId/recipe        — attach {recipeId}   (requireAuth, owner-only)
DELETE /v1/posts/:postId/recipe/:recipeId — detach          (requireAuth, owner-only)
```

Pass `c.env` into the service calls that resolve paints. Errors flow through the
existing `onError` handler — never leak D1 detail (already handled centrally).

---

## 8. Frontend (loaders call services, browser calls the API)

Per `docs/ARCHITECTURE.md` ("Loaders call services, the browser calls the API"):

- `app/lib/data.server.ts` gains the `getRecipe` / `listRecipesByOwner` bridge
  exports so the SSR loader reaches the service directly.
- `app/routes.ts`: `/@:username/recipes/:slug` (public page),
  `/recipes/new`, `/recipes/:slug/edit` (owner flows). Match the existing
  `project` route shape — recipes are the same "owned, slug-based, own page"
  pattern.
- Components: a `RecipeView` (ordered steps, each step's paint linked to
  `shopUrl` when set — rendered with `rel="nofollow ugc noopener noreferrer"`
  like every user link), a "paints in this recipe" strip reusing the
  `post_product` presentation, and a step editor. On a post that has an attached
  recipe, render the recipe's steps as the "paints used" strip instead of
  `post_product`.
- `ReportButton` on the recipe page (safety posture — recipes carry free text).

The `HowTo` structured data and sitemap entry are **phase 2**; the page ships
without them first.

---

## 9. Migration

`npm run db:generate` produces the additive SQL under `migrations/` (new tables +
`profile.recipe_count`); `db:migrate:local` to apply and test, `db:migrate:remote`
at deploy. Additive and back-compatible: an account with no recipes and no
`post_recipe` rows behaves exactly as today. No change to `post` or
`post_product`.

---

## 10. Tests (`tests/`, `logic.test.ts` style)

Pure logic and degradation first, thin integration second:

- **Resolver degradation** — with `SHOP_STOREFRONT_*` unset, `resolvePaint`
  returns `null`, makes no fetch, and a `createPost` with products still succeeds
  and stores plain names. Guard this the way `no-published-email.test.ts` guards
  the transactional path.
- **Cache semantics** — a hit returns the cached URL without a fetch; a miss
  caches the `""` sentinel and is not re-queried; the `v1` key namespaces it.
- **Match conservatism** — a name with no confident match resolves to `null`, not
  a wrong product (feed a fixture Storefront response).
- **Recipe create** — steps persist in order; `profile.recipeCount` increments;
  slug is unique per owner (a second "Death Guard rust" gets a distinct slug).
- **Visibility** — a `private` recipe 404s for a non-owner; `unlisted` is
  reachable by link but absent from `listRecipesByOwner`.
- **Attach/detach** — `useCount` moves up and down with the `max(0, n-1)` floor;
  attach is idempotent (`onConflictDoNothing`).
- **Zod caps** — `>40` steps, over-length title/note are rejected at the boundary.

---

## Build checklist (PR-sized, in order)

1. **`paints.ts` + wire into `createPost`, config guard, tests.** Ship it alone —
   this is roadmap item 3 and it delivers value with no recipe UI. One PR.
2. **Schema + migration + taxonomy `TECHNIQUES`.** Additive tables, no behaviour
   yet. One PR (or folded into 3).
3. **`recipes.ts` service + Zod + API routes + tests.** The backend of the recipe
   object, exercised by tests before any UI.
4. **Frontend: page, create/edit, attach-to-post.** The painter-facing half.

Phase 2 (separate spec) picks up from here: `recipe_save`, forking with
attribution, the discovery strip, `HowTo` structured data, and the
save/fork notifications.
