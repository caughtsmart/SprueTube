import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { api } from "../lib/api";
import { RecipeView, type RecipeStepView } from "./RecipeView";

export type AttachedRecipe = {
  recipe: { id: string; slug: string; title: string };
  steps: RecipeStepView[];
};

export type OwnRecipe = { id: string; slug: string; title: string };

/**
 * Recipes shown on a post.
 *
 * A post credits a documented scheme instead of, or alongside, the flat "paints
 * used" strip: the same paints, but in order and with the method. The author
 * gets a small control to attach one of their own recipes or detach it; the API
 * (POST/DELETE /posts/:id/recipe) already requires owning both, so this is only
 * ever the poster's own recipes on their own post.
 */
export function PostRecipes({
  postId,
  ownerUsername,
  attached,
  ownRecipes,
  isAuthor,
}: {
  postId: string;
  ownerUsername: string;
  attached: AttachedRecipe[];
  ownRecipes: OwnRecipe[];
  isAuthor: boolean;
}) {
  const revalidator = useRevalidator();
  const [pick, setPick] = useState("");
  const [pending, setPending] = useState(false);

  const attachedIds = new Set(attached.map((entry) => entry.recipe.id));
  const available = ownRecipes.filter((recipe) => !attachedIds.has(recipe.id));

  if (!attached.length && !isAuthor) return null;

  async function attach() {
    if (!pick) return;
    setPending(true);
    try {
      await api.post(`/posts/${postId}/recipe`, { recipeId: pick });
      setPick("");
      revalidator.revalidate();
    } finally {
      setPending(false);
    }
  }

  async function detach(recipeId: string) {
    setPending(true);
    try {
      await api.delete(`/posts/${postId}/recipe/${recipeId}`);
      revalidator.revalidate();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-6" aria-label="Recipes on this post">
      {attached.map(({ recipe, steps }) => (
        <div key={recipe.id} className="mb-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <Link
              to={`/@${ownerUsername}/recipes/${recipe.slug}`}
              className="st-text-strong text-sm font-semibold hover:underline"
            >
              🎨 {recipe.title}
            </Link>
            {isAuthor ? (
              <button
                type="button"
                onClick={() => detach(recipe.id)}
                disabled={pending}
                className="st-text-muted hover:st-text-strong text-xs"
              >
                Remove
              </button>
            ) : null}
          </div>
          <RecipeView steps={steps} />
        </div>
      ))}

      {isAuthor ? (
        available.length ? (
          <div className="st-card flex flex-wrap items-center gap-2 p-3">
            <label htmlFor="attach-recipe" className="st-text-muted text-sm">
              Add a recipe:
            </label>
            <select
              id="attach-recipe"
              value={pick}
              onChange={(event) => setPick(event.target.value)}
              className="st-input w-auto min-w-0 flex-1"
            >
              <option value="">One of your recipes…</option>
              {available.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={attach}
              disabled={!pick || pending}
              className="st-btn st-btn-ghost text-sm"
            >
              Add
            </button>
          </div>
        ) : !ownRecipes.length ? (
          <p className="st-text-muted text-sm">
            Painted this with a scheme worth keeping?{" "}
            <Link to="/recipes/new" className="st-link">
              Write it as a recipe
            </Link>{" "}
            and add it here.
          </p>
        ) : null
      ) : null}
    </section>
  );
}
