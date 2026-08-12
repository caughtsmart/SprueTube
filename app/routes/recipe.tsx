import { data, Link } from "react-router";
import { sql } from "drizzle-orm";
import type { Route } from "./+types/recipe";
import { Avatar } from "../components/Avatar";
import { RecipeView } from "../components/RecipeView";
import { getScope } from "../lib/data.server";
import { fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import { findRecipe, getRecipeWithSteps } from "../../server/services/recipes";
import { block, profile } from "../../server/db/schema";
import { GAME_SYSTEM_LABELS } from "../lib/taxonomy";

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
  ];
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
      updatedAt: found.updatedAt,
    },
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
          ) : null}
        </div>

        {recipe.summary ? (
          <p className="mt-4 text-[0.9375rem] leading-relaxed">
            {recipe.summary}
          </p>
        ) : null}

        <div className="st-text-muted mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
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
