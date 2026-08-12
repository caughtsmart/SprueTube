# Recipes

A design for the one artefact this hobby wants most and no rival holds well: a
**paint recipe** — the reusable, saveable, shoppable scheme for how a model was
painted. Base, wash, highlight, technique; the actual paints; the note that says
"thinned 2:1". It is the answer to "what colours did you use", made durable
instead of buried in a comment thread that scrolls away forever.

This came out of the community/gamification review (`docs/COMMUNITY.md`, "Part
three") as the strongest idea that was not really a community or gamification
feature at all, so it gets its own document.

> **Status.** Design only. Nothing here is built. It has one hard dependency that
> is *also* an existing roadmap item — paint-name resolution (`docs/ROADMAP.md`
> item 3) — and §Paint resolution folds that item in rather than duplicating it.

## Why recipes, and why they are the wedge

Three reasons, in the order they matter.

**They are the thing Reddit and Instagram structurally cannot do.** A build-log
platform's real moat is structure Reddit's flat threads and Instagram's captions
have no place to hold. "How did you get that oil-wash so clean" is answered a
thousand times a day across the hobby and the answer *evaporates every time* — it
lives in a reply, unsearchable, unattached to the model, gone next week. A recipe
is that answer turned into an object: attached to the photo, saved to your own
collection, searchable, and re-applicable to your next model. This is a
migration wedge in a way no badge is — people move for a tool, not a trophy.

**They make the knowledge durable, which the rest of the design only gestured
at.** The community doc's "helpful" marks make good *answers visible*; they leave
the *knowledge ephemeral*. Recipes make the knowledge itself the artefact.

**They monetise directly, and the plumbing already half-exists.** `post_product`
(`server/db/schema.ts`) is described in its own comment as "the quiet commercial
layer": each paint named under a photo can carry a `shop_url`, resolved at write
time. A recipe is that layer made first-class — a whole scheme that resolves to a
Loaded Dice basket, "buy every paint in this recipe", without a post ever looking
like an advert. It is the roadmap's "paint links that resolve" earning its keep.

## What exists today, and the gap

`post_product` is a flat, per-post list: `{ kind, name, brand, shop_url,
position }`, cascade-deleted with its post. It is perfect for a quick photo — name
three paints, move on — and it must stay exactly that.

What it cannot be:

- **Reusable.** It belongs to one post and dies with it. The same scheme painted
  on ten models is retyped ten times.
- **Ordered method.** It is a bag of products, not "base → wash → edge
  highlight". There is no technique, no step, no note.
- **Saveable or forkable.** Nobody can keep someone else's scheme, or adapt it.

A recipe is all three. So recipes are a **new object beside `post_product`, not a
replacement** — the additive, back-compatible move the codebase always makes.

## The decision: a standalone object, joined to posts, never replacing the quick list

A recipe is owned by a person, not by a post. You can write one from scratch
("My Death Guard rust"), or lift one out of a post you already made. A post that
wants to show a documented scheme *references* a recipe; a post that just wants to
name three paints keeps using `post_product` and touches none of this.

Where a post shows a recipe, the recipe's steps render the "paints used" strip —
so the commercial layer and the method are the same object and nobody types a
paint twice. `post_product` is the quick path; recipes are the documented path.

## Schema

### `recipe`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `rcp_` + the standard id scheme. |
| `owner_id` | text, FK → user, cascade | The author. |
| `slug` | text | Unique per owner, like `project.slug` — the recipe lives at `/@user/recipes/:slug`. |
| `title` | text | "Death Guard rust", "Speed-paint zenithal skin". |
| `summary` | text, null | One line, for cards and search. |
| `game_system` / `scale` | text, null | Reuses the taxonomy, so recipes filter by system like everything else. |
| `cover_image_id` | text, null | Cloudflare Images id; falls back to the newest post that uses it. |
| `visibility` | text enum | `public` \| `unlisted` \| `private`, mirroring `post.visibility`'s intent. Public is the SEO/discovery case. |
| `forked_from_id` | text, null, FK → recipe | Set when this recipe was forked from another (see Forking). |
| `save_count` / `fork_count` / `use_count` | int, default 0 | Denormalised, batched with the write, `max(0, n-1)` on removal — the house pattern. `use_count` = posts that attach it. |
| `created_at` / `updated_at` | int | |

### `recipe_step`

The method, ordered. Each step is one action with one paint and an optional note —
and each step reuses the exact paint-resolution machinery `post_product` uses, so
a step resolves to the shop the same way a quick-list paint does.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `rstep_` + id scheme, so a step list paginates keyset. |
| `recipe_id` | text, FK → recipe, cascade | |
| `position` | int | Order of the step. |
| `technique` | text enum | `prime` \| `base` \| `layer` \| `wash` \| `shade` \| `drybrush` \| `edge_highlight` \| `glaze` \| `wet_blend` \| `weathering` \| `other`. Controlled vocabulary in `taxonomy.ts`, next to the WIP stages it sits alongside conceptually. |
| `product_name` | text, null | The paint/medium. Null for a pure technique step ("stipple with a torn sponge"). |
| `brand` | text, null | As `post_product`. |
| `shop_url` | text, null | **Resolved at write time**, exactly as `post_product.shop_url` — the feed and the recipe page never call the shop. |
| `note` | text, null | "Thinned 2:1", "two coats", the thing that actually makes it work. |

### `post_recipe`

A join, not a column on `post` — so the hot `post` table is untouched, and a
diorama can credit more than one scheme later without a schema change.

| Column | Type | Meaning |
| --- | --- | --- |
| `post_id` | text, FK → post, cascade | |
| `recipe_id` | text, FK → recipe, cascade | |
| `created_at` | int | |

Primary key `(post_id, recipe_id)`. Attaching bumps `recipe.use_count` in the
same batch.

### `recipe_save`

Keeping someone's recipe in your own collection — a bookmark specific to recipes,
its own table for its own count rather than overloading `bookmark`.

| Column | Type | Meaning |
| --- | --- | --- |
| `recipe_id` | text, FK → recipe, cascade | |
| `user_id` | text, FK → user, cascade | |
| `created_at` | int | |

Primary key `(recipe_id, user_id)` — idempotent, the same shape as `like`, so a
double-save is a no-op and cannot inflate `save_count`.

## Paint resolution — the shared engine, and roadmap item 3

Recipes do not invent paint resolution; they finally make it worth building.
Roadmap item 3 is exactly this and is currently unbuilt (`shop_url` is stored but
never filled). This design pulls it into one place:

- A `server/services/paints.ts` with `resolvePaint(name, brand?) → shopUrl | null`,
  matching a paint name against the Loaded Dice catalogue via the Shopify
  Storefront API at **write time**, cached in KV (the catalogue changes slowly).
- **Both** `post_product` writes **and** `recipe_step` writes call it, so the
  quick list and the documented recipe share one resolver and one cache.
- **It degrades to plain text.** An unresolved paint is stored with a null
  `shop_url` and rendered as its name, exactly as `post_product` behaves today. A
  recipe is fully usable with zero paints resolved; resolution is upside, never a
  dependency for the feature to ship.

This is the one place recipes and the existing roadmap converge: build item 3 as
`paints.ts`, and recipes get the commercial layer for free.

## The recipe page, and the SEO it unlocks

`/@user/recipes/:slug`, public by default, owned and slug-based like a project.
It is the single highest-value SEO surface the site could add. The architecture
doc already names "How to paint Death Guard rust" as "a real query with real
volume" and organic search as "the cheapest growth available" — a recipe page
*is* that answer, structured.

- Render the ordered steps, each with its paint (linked to the shop where
  resolved), brand and note.
- Emit **schema.org `HowTo`** structured data — a recipe is literally a HowTo with
  steps and supplies, so it is eligible for the rich result Google shows for
  method content. This is the concrete acquisition mechanic the badges never had.
- A "paints in this recipe" basket strip — the `post_product` commercial layer,
  now a whole shoppable scheme.
- Include it in the sitemap alongside posts and profiles (architecture "SEO").

## Forking — how knowledge propagates with credit

The mechanic that makes recipes a *network* rather than a pile of private notes,
and the thing Reddit's model actively prevents.

- **Save** keeps a public recipe in your collection unchanged.
- **Fork** copies its steps into a new recipe you own and can edit — "same rust,
  but I use Vallejo" — with `forked_from_id` set so the new recipe **credits the
  original author** on its page and bumps the original's `fork_count`.

Forking with attribution is the anti-evaporation fix: an improvement to a scheme
becomes a new public artefact that still points home, instead of a reply nobody
will ever find again. It is `git fork` for paint schemes, and it is the reason a
knowledgeable painter would rather answer here than on Reddit — their answer
compounds instead of scrolling away.

## Discovery, community and gamification ties

- **Discovery** reuses the highlights pattern (`server/services/highlights.ts`):
  a "popular recipes" strip computed into KV on the `*/15` cron, capped per author
  and gated behind a count threshold exactly as `docs/COMMUNITY.md` specifies, so
  it never shows a wall of two. Ranked by `save_count`/`fork_count`, a published
  rule — not an opaque algorithm.
- **Communities** (`docs/COMMUNITY.md`): a community page can surface the top
  recipes for its game system, since `recipe.game_system` reuses the taxonomy.
- **Gamification** (`docs/COMMUNITY.md`): a recipe forked or saved by many people
  is the *strongest* possible "helping hand" signal — better than the comment
  `helpful` mark, because a save is a durable act, not a click. A badge for "a
  recipe others actually use" tied to `fork_count`/`save_count` is artefact-tied
  and un-farmable, satisfying that doc's anti-gaming rule.

## Safety

Recipes are user content and inherit the schema-first posture
(`docs/ARCHITECTURE.md`):

- A recipe and its steps carry free text (`title`, `summary`, `note`), so the
  recipe page needs `ReportButton` and its author is subject to `block`/`mute` —
  a saved/forked recipe from a blocked author is filtered by the same
  `hiddenAmong` used everywhere else, and the "popular recipes" strip applies the
  viewer's blocks **and mutes**.
- Forking copies text, so a forked recipe that carries abuse is reportable in its
  own right and moderating the original does not silently mutate every fork
  (each is a separate owned artefact) — but a moderation removal writes to the
  append-only `moderation_action` log as usual.
- `shop_url` is written by the server-side resolver, never by the user, so a
  recipe cannot be a vector for arbitrary outbound links; user-supplied links in
  a `note` render with the same `rel="nofollow ugc noopener noreferrer"` as post
  bodies.

## Notifications

Reuses the one choke point `createNotification()` (`docs/NOTIFICATIONS.md`). One
new `notification` type — `recipe_saved` / `recipe_forked` (someone kept or
adapted your scheme) — added additively across the three places the community doc
already inventories (the Drizzle enum, the `createNotification` signature union,
`push.ts`), riding the existing `muted_types` preference. It is the same
"someone valued your work" class as a like, and just as muteable.

## Migrations

Additive only, `npm run db:generate`: `recipe`, `recipe_step`, `post_recipe`,
`recipe_save`, the denormalised counters (`recipe.save_count`/`fork_count`/
`use_count`, `profile.recipe_count`). No change to `post` or `post_product`; a
person who never opens a recipe sees the site exactly as today. The
`technique` vocabulary is a new constant in `taxonomy.ts`.

## Testing

Following the `tests/logic.test.ts` and highlights style:

- **Paint resolution** — `resolvePaint` returns a `shop_url` on a catalogue hit
  and `null` on a miss; a miss stores plain text and never fails the write. The
  KV cache is honoured. Guard the no-shop / unconfigured case as a clean no-op,
  the way the transactional email path is guarded.
- **Fork attribution** — a fork sets `forked_from_id`, bumps the origin's
  `fork_count`, and copies steps; deleting the origin leaves the fork intact
  (the FK is nullable, `set null` on delete) and its credit line degrades
  gracefully.
- **Idempotent save** — a second `recipe_save` is a no-op; an unsave decrements
  with the `max(0, n-1)` floor.
- **HowTo output** — the structured-data serialiser emits valid `HowTo` JSON for a
  recipe with steps and supplies, and omits a step's supply cleanly when it is a
  pure-technique step.
- **Hidden filtering** — a blocked or muted author is absent from the popular-
  recipes strip.

## Build order

Sequenced so each step ships something usable and the commercial engine comes on
early.

1. **`paints.ts` resolution (roadmap item 3).** Build the resolver first and wire
   it into the *existing* `post_product` write. This lights up the paint links
   that are already stored-but-empty, ships value before a single recipe exists,
   and is the engine recipes then reuse.
2. **The recipe object.** `recipe` + `recipe_step`, the owner's create/edit flow,
   the public `/@user/recipes/:slug` page with the shoppable strip. A painter can
   now write and share a scheme.
3. **Attach to posts.** `post_recipe`, so a build-log photo credits its recipe and
   renders it as the "paints used" strip.
4. **Save, fork, discovery.** `recipe_save`, forking with attribution, the popular-
   recipes strip, the `recipe_saved`/`recipe_forked` notification. This is where
   recipes become a network rather than private notes.
5. **HowTo structured data + sitemap.** The SEO surface, once there are public
   recipes worth crawling.

## Deliberately not in v1

- **Versioning a recipe.** A recipe is edited in place; there is no history of
  "v1 → v2". Forking covers the "I changed it" case with attribution, which is the
  version story that matters to a reader. Real version history can come if anyone
  asks.
- **Quantities and mixing ratios as structured fields.** The `note` carries "2:1
  Contrast Medium" as text in v1. Structuring it is a nice-to-have that a free-
  text note serves until there is a reason to compute over it.
- **Non-paint recipes** (basing recipes, sculpting steps) — the `technique`
  vocabulary can grow, but v1 is about paint, which is where the volume and the
  commercial pull both are.
- **Auto-generating a recipe from a post's `post_product` rows.** Tempting, but a
  bag of paints is not a method, and a half-inferred recipe reads worse than none.
  A recipe is written on purpose.
