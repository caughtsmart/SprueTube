import type { Route } from "./+types/tag";
import { Feed } from "../components/Feed";
import { getScope } from "../lib/data.server";
import { pickAd } from "../../server/services/ads";
import { getFeed } from "../../server/services/feed";

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `#${params.tag} — SprueTube` },
    {
      name: "description",
      content: `Posts tagged #${params.tag} by miniature painters and model makers on SprueTube.`,
    },
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const page = await getFeed(scope.db, {
    tab: "latest",
    viewerId: scope.viewer?.userId ?? null,
    tagName: params.tag,
  });

  return {
    tag: params.tag.toLowerCase(),
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad: await pickAd(scope.db, "feed"),
  };
}

export default function TagPage({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">#{loaderData.tag}</h1>
      <Feed
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint={`/feed?tab=latest&tag=${encodeURIComponent(loaderData.tag)}`}
        ad={loaderData.ad}
        emptyState={
          <>
            <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
            <h2 className="mt-4 text-lg font-semibold">
              Nothing tagged #{loaderData.tag} yet
            </h2>
            <p className="st-text-muted mt-2 text-sm">
              Use the tag in a post and you will be the first.
            </p>
          </>
        }
      />
    </div>
  );
}
