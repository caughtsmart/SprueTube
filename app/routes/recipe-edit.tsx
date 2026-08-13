import { data, redirect } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/recipe-edit";
import { RecipeForm, type RecipeStepDraft } from "../components/RecipeForm";
import { getScope } from "../lib/data.server";
import { getRecipeWithSteps } from "../../server/services/recipes";
import { recipe } from "../../server/db/schema";
import type { Technique } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Edit recipe — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) {
    throw redirect(`/login?next=/${params.handle}/recipes/${params.slug}/edit`);
  }

  // Ownership is decided by the session, not the handle: looking it up by the
  // viewer's own id means someone else's slug simply does not resolve.
  const found = await scope.db.query.recipe.findFirst({
    where: and(
      eq(recipe.ownerId, scope.viewer.userId),
      eq(recipe.slug, params.slug),
    ),
  });
  if (!found) {
    throw data({ message: "That recipe is not yours." }, { status: 404 });
  }

  const full = await getRecipeWithSteps(scope.db, found.id);
  const steps: RecipeStepDraft[] = (full?.steps ?? []).map((step) => ({
    technique: step.technique as Technique,
    productName: step.productName ?? "",
    brand: step.brand ?? "",
    note: step.note ?? "",
  }));

  return {
    username: scope.viewer.profile.username,
    recipeId: found.id,
    slug: found.slug,
    initial: {
      title: found.title,
      summary: found.summary ?? "",
      gameSystem: found.gameSystem ?? "",
      scale: found.scale ?? "",
      visibility: found.visibility,
      steps: steps.length ? steps : [{ technique: "base" as Technique, productName: "", brand: "", note: "" }],
    },
  };
}

export default function EditRecipe({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Edit recipe</h1>
      <RecipeForm
        initial={loaderData.initial}
        recipeId={loaderData.recipeId}
        slug={loaderData.slug}
        username={loaderData.username}
      />
    </div>
  );
}
