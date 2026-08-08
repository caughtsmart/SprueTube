import { redirect } from "react-router";
import type { Route } from "./+types/saved";
import { PostCard } from "../components/PostCard";
import { getScope } from "../lib/data.server";
import { getBookmarks } from "../../server/services/feed";

export function meta() {
  return [{ title: "Saved — SprueTube" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/saved");

  return { posts: await getBookmarks(scope.db, scope.viewer.userId) };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Saved</h1>

      {loaderData.posts.length ? (
        <div className="flex flex-col gap-4">
          {loaderData.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <div className="st-card p-10 text-center">
          <p className="text-4xl">☆</p>
          <h2 className="mt-4 text-lg font-semibold">Nothing saved yet</h2>
          <p className="st-text-muted mt-2 text-sm">
            Save a technique you want to try and it will wait here for you.
          </p>
        </div>
      )}
    </div>
  );
}
