import { Link, redirect } from "react-router";
import type { Route } from "./+types/saved";
import { PostCard } from "../components/PostCard";
import { getScope } from "../lib/data.server";
import { getBookmarks } from "../../server/services/feed";
import { listSavedRecipes } from "../../server/services/recipes";

export function meta() {
  return [{ title: "Saved — SprueTube" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/saved");

  const [posts, recipes] = await Promise.all([
    getBookmarks(scope.db, scope.viewer.userId),
    listSavedRecipes(scope.db, scope.viewer.userId),
  ]);

  return { posts, recipes };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const empty = !loaderData.posts.length && !loaderData.recipes.length;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Saved</h1>

      {loaderData.recipes.length ? (
        <section className="mb-6" aria-label="Saved recipes">
          <h2 className="mb-2 text-sm font-semibold">Recipes</h2>
          <ul className="flex flex-wrap gap-2">
            {loaderData.recipes.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  to={`/@${recipe.ownerUsername}/recipes/${recipe.slug}`}
                  className="st-card block px-3 py-2 transition hover:border-[var(--color-primer-500)]"
                >
                  <p className="text-sm font-medium">{recipe.title}</p>
                  <p className="st-text-muted text-xs">
                    by {recipe.ownerDisplayName}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loaderData.posts.length ? (
        <div className="flex flex-col gap-4">
          {loaderData.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="st-card p-10 text-center">
          <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
          <h2 className="mt-4 text-lg font-semibold">Nothing saved yet</h2>
          <p className="st-text-muted mt-2 text-sm">
            Save a post or a recipe you want to come back to and it will wait
            here for you.
          </p>
        </div>
      ) : null}
    </div>
  );
}
