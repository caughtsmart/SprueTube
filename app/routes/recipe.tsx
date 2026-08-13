import { data, Link } from "react-router";
import { and, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/recipe";
import { Avatar } from "../components/Avatar";
import { RecipeActions } from "../components/RecipeActions";
import { RecipeView } from "../components/RecipeView";
import { getScope } from "../lib/data.server";
import { fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import {
  canViewRecipe,
  findRecipe,
  getRecipeWithSteps,
} from "../../server/services/recipes";
import { block, profile, recipe, recipeSave } from "../../server/db/schema";
import { GAME_SYSTEM_LABELS, TECHNIQUE_LABELS, type Technique } from "../lib/taxonomy";

const VISIBILITY_NOTE: Record<string, string | null> = {
  public: null,
  unlisted: "Unlisted — only people with the link",
  private: "Private — only you can see this",
};

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.recipe) return [{ title: "Recipe — SprueTube" }];
  const { recipe, owner } = loaded;
  const description =
    recipe.summary ??
    `${owner.displayName}'s paint recipe: ${recipe.title}, step by step, on SprueTube.`;
  return [
    { title: `${recipe.title} — a paint recipe by ${owner.displayName} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: recipe.title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    // Only a public recipe is for search. "Unlisted" means link-only, so it
    // must not be indexed if a crawler ever finds the URL — and only a public
    // recipe emits the HowTo rich-result data.
    ...(recipe.visibility === "public"
      ? [{ "script:ld+json": howToJsonLd(loaded) }]
      : [{ name: "robots", content: "noindex" }]),
  ];
}

/**
 * schema.org HowTo for a recipe — a method with steps and supplies is exactly
 * what HowTo describes, and it makes "how to paint X" pages eligible for the
 * rich result Google shows for method content. Emitted through React Router's
 * `script:ld+json` meta descriptor, which serialises it safely (no
 * dangerouslySetInnerHTML, per the architecture rule).
 */
function howToJsonLd(loaded: {
  recipe: { title: string; summary: string | null };
  steps: {
    technique: string;
    productName: string | null;
    brand: string | null;
    note: string | null;
  }[];
  owner: { displayName: string };
}) {
  const named = (productName: string | null, brand: string | null) =>
    [brand, productName].filter(Boolean).join(" ");

  const supplies = [
    ...new Set(
      loaded.steps
        .filter((step) => step.productName)
        .map((step) => named(step.productName, step.brand)),
    ),
  ];

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: loaded.recipe.title,
    ...(loaded.recipe.summary ? { description: loaded.recipe.summary } : {}),
    author: { "@type": "Person", name: loaded.owner.displayName },
    ...(supplies.length
      ? { supply: supplies.map((name) => ({ "@type": "HowToSupply", name })) }
      : {}),
    step: loaded.steps.map((step, index) => {
      const label =
        TECHNIQUE_LABELS[step.technique as Technique] ?? step.technique;
      const paint = named(step.productName, step.brand);
      const text = [paint, step.note].filter(Boolean).join(" — ") || label;
      return {
        "@type": "HowToStep",
        position: index + 1,
        name: label,
        text,
      };
    }),
  };
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  if (!params.handle.startsWith("@")) {
    throw data({ message: "Page not found." }, { status: 404 });
  }
  const username = params.handle.slice(1);

  const owner = await scope.db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!owner || owner.status === "deleted") {
    throw data({ message: "No such painter." }, { status: 404 });
  }

  const viewerId = scope.viewer?.userId ?? null;
  const isOwner = viewerId === owner.userId;

  // A block hides a recipe exactly as it hides the profile.
  if (viewerId && !isOwner) {
    const blocked = await scope.db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${owner.userId})
            or (${block.blockerId} = ${owner.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) throw data({ message: "No such recipe." }, { status: 404 });
  }

  const found = await findRecipe(scope.db, owner.userId, params.slug);
  if (!found) throw data({ message: "No such recipe." }, { status: 404 });

  // Private is the owner's alone; unlisted is reachable by anyone with the link.
  if (found.visibility === "private" && !isOwner) {
    throw data({ message: "No such recipe." }, { status: 404 });
  }

  const full = await getRecipeWithSteps(scope.db, found.id);
  if (!full) throw data({ message: "No such recipe." }, { status: 404 });

  // Has the viewer saved this, and what was it forked from (if the origin is
  // still there and they may see it)?
  const saved = viewerId
    ? Boolean(
        await scope.db.query.recipeSave.findFirst({
          where: and(
            eq(recipeSave.recipeId, found.id),
            eq(recipeSave.userId, viewerId),
          ),
        }),
      )
    : false;

  let forkedFrom: { username: string; slug: string; title: string } | null = null;
  if (found.forkedFromId) {
    const origin = await scope.db.query.recipe.findFirst({
      where: eq(recipe.id, found.forkedFromId),
    });
    if (origin && canViewRecipe(origin.visibility, origin.ownerId === viewerId)) {
      const originOwner = await scope.db.query.profile.findFirst({
        where: eq(profile.userId, origin.ownerId),
      });
      if (originOwner) {
        forkedFrom = {
          username: originOwner.username,
          slug: origin.slug,
          title: origin.title,
        };
      }
    }
  }

  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };

  return {
    recipe: {
      id: found.id,
      slug: found.slug,
      title: found.title,
      summary: found.summary,
      gameSystem: found.gameSystem,
      scale: found.scale,
      visibility: found.visibility,
      saveCount: found.saveCount,
      forkCount: found.forkCount,
      updatedAt: found.updatedAt,
    },
    saved,
    forkedFrom,
    steps: full.steps.map((step) => ({
      id: step.id,
      position: step.position,
      technique: step.technique,
      productName: step.productName,
      brand: step.brand,
      shopUrl: step.shopUrl,
      note: step.note,
    })),
    owner: {
      username: owner.username,
      displayName: owner.displayName,
      avatarImageId: owner.avatarImageId,
    },
    avatarUrl: imageSrc(config, owner.avatarImageId, "avatar"),
    isOwner,
  };
}

export default function RecipePage({ loaderData }: Route.ComponentProps) {
  const { recipe, owner } = loaderData;

  const facts = [
    recipe.gameSystem
      ? (GAME_SYSTEM_LABELS[
          recipe.gameSystem as keyof typeof GAME_SYSTEM_LABELS
        ] ?? recipe.gameSystem)
      : null,
    recipe.scale,
  ].filter(Boolean);

  const visibilityNote = VISIBILITY_NOTE[recipe.visibility];

  return (
    <div className="mx-auto max-w-2xl">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="st-text-muted text-xs font-semibold tracking-wide uppercase">
              Paint recipe
            </p>
            <h1 className="mt-1 text-xl font-bold">{recipe.title}</h1>
            <Link
              to={`/@${owner.username}`}
              className="mt-2 flex min-w-0 items-center gap-2"
            >
              <Avatar
                username={owner.username}
                src={loaderData.avatarUrl}
                size={32}
              />
              <span className="st-text-strong truncate text-sm font-medium">
                {owner.displayName}
              </span>
              <span className="st-text-muted truncate text-sm">
                @{owner.username}
              </span>
            </Link>
          </div>

          {loaderData.isOwner ? (
            <Link
              to={`/@${owner.username}/recipes/${recipe.slug}/edit`}
              className="st-btn st-btn-ghost shrink-0 text-sm"
            >
              Edit
            </Link>
          ) : (
            <RecipeActions
              recipeId={recipe.id}
              path={`/@${owner.username}/recipes/${recipe.slug}`}
              initialSaved={loaderData.saved}
              saveCount={recipe.saveCount}
            />
          )}
        </div>

        {loaderData.forkedFrom ? (
          <p className="st-text-muted mt-3 text-sm">
            🔱 Forked from{" "}
            <Link
              to={`/@${loaderData.forkedFrom.username}/recipes/${loaderData.forkedFrom.slug}`}
              className="st-link"
            >
              {loaderData.forkedFrom.title}
            </Link>{" "}
            by @{loaderData.forkedFrom.username}
          </p>
        ) : null}

        {recipe.summary ? (
          <p className="mt-4 text-[0.9375rem] leading-relaxed">
            {recipe.summary}
          </p>
        ) : null}

        <div className="st-text-muted mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
          {recipe.saveCount > 0 ? <span>{recipe.saveCount} saved</span> : null}
          {recipe.forkCount > 0 ? <span>{recipe.forkCount} forked</span> : null}
          <span>updated {fullDate(recipe.updatedAt)}</span>
          {visibilityNote ? (
            <span className="st-chip text-xs">{visibilityNote}</span>
          ) : null}
        </div>
      </header>

      <section className="mt-6" aria-label="Recipe steps">
        <RecipeView steps={loaderData.steps} />
      </section>
    </div>
  );
}
