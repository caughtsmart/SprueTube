import { data } from "react-router";
import type { Route } from "./+types/system";
import { Feed } from "../components/Feed";
import { getScope } from "../lib/data.server";
import { pickAd } from "../../server/services/ads";
import { getFeed } from "../../server/services/feed";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS } from "../lib/taxonomy";

type SystemSlug = (typeof GAME_SYSTEMS)[number];

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  const label = loaded?.label ?? "Posts";
  return [
    { title: `${label} — SprueTube` },
    {
      name: "description",
      content: `${label} miniatures painted and built by the SprueTube community. Work in progress, finished models and the paints behind them.`,
    },
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const slug = params.system as SystemSlug;
  if (!GAME_SYSTEMS.includes(slug)) {
    throw data({ message: "Unknown game system." }, { status: 404 });
  }

  const scope = await getScope(context, request);
  const page = await getFeed(scope.db, {
    tab: "latest",
    viewerId: scope.viewer?.userId ?? null,
    gameSystem: slug,
  });

  return {
    label: GAME_SYSTEM_LABELS[slug],
    slug,
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad: await pickAd(scope.db, "feed"),
  };
}

export default function SystemPage({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{loaderData.label}</h1>
      <Feed
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint={`/feed?tab=latest&system=${loaderData.slug}`}
        ad={loaderData.ad}
      />
    </div>
  );
}
