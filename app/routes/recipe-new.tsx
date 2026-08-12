import { redirect } from "react-router";
import type { Route } from "./+types/recipe-new";
import { EMPTY_RECIPE, RecipeForm } from "../components/RecipeForm";
import { getScope } from "../lib/data.server";

export function meta() {
  return [
    { title: "New recipe — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/recipes/new");
  if (!scope.viewer.profile.birthdate) throw redirect("/welcome");

  return { username: scope.viewer.profile.username };
}

export default function NewRecipe({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">New recipe</h1>
      <p className="st-text-muted mb-4 text-sm">
        Write down how you painted something — the paints, in order, with the
        notes that make it work. Others can follow it, and each paint links to
        the shop.
      </p>

      <RecipeForm initial={EMPTY_RECIPE} username={loaderData.username} />
    </div>
  );
}
