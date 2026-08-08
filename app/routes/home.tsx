import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/home";
import { Feed } from "../components/Feed";
import { Landing } from "../components/Landing";
import { getScope } from "../lib/data.server";
import { pickAd } from "../../server/services/ads";
import { getFeed, type FeedTab } from "../../server/services/feed";

export function meta({ loaderData }: Route.MetaArgs) {
  const signedIn = Boolean(loaderData?.signedIn);
  return [
    {
      title: signedIn
        ? "Your feed — SprueTube"
        : "SprueTube — where model makers and miniature painters share their work",
    },
    {
      name: "description",
      content:
        "SprueTube is the social network for miniature painters and model makers. Post work in progress, follow build logs from sprue to finished, and find out exactly which paints someone used.",
    },
    { property: "og:site_name", content: "SprueTube" },
    { property: "og:type", content: "website" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const url = new URL(request.url);

  const requested = url.searchParams.get("tab");
  // Signed-out visitors get Discover; there is no graph to build a feed from.
  const tab: FeedTab = !scope.viewer
    ? "discover"
    : requested === "discover" || requested === "latest"
      ? requested
      : "following";

  const [page, ad] = await Promise.all([
    getFeed(scope.db, {
      tab,
      viewerId: scope.viewer?.userId ?? null,
    }),
    pickAd(scope.db, "feed"),
  ]);

  return {
    signedIn: Boolean(scope.viewer),
    tab,
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad,
  };
}

const TABS: { value: FeedTab; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "discover", label: "Discover" },
  { value: "latest", label: "Latest" },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();

  if (!loaderData.signedIn) {
    return (
      <Landing posts={loaderData.posts} ad={loaderData.ad} />
    );
  }

  const active = loaderData.tab;

  return (
    <div className="mx-auto max-w-2xl">
      <nav
        className="st-border mb-4 flex gap-1 border-b pb-2"
        aria-label="Feed selection"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            to={tab.value === "following" ? "/" : `/?tab=${tab.value}`}
            className={[
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active === tab.value
                ? "st-raised st-text-strong"
                : "st-text-muted hover:st-text-strong",
            ].join(" ")}
            aria-current={active === tab.value ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Feed
        key={`${active}-${searchParams.toString()}`}
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint={`/feed?tab=${active}`}
        ad={loaderData.ad}
        emptyState={
          active === "following" ? (
            <>
              <p className="text-4xl">👋</p>
              <h2 className="mt-4 text-lg font-semibold">
                Your feed is empty
              </h2>
              <p className="st-text-muted mt-2 text-sm">
                Follow a few painters and their work will land here.
              </p>
              <Link to="/explore" className="st-btn st-btn-primary mt-5">
                Find people to follow
              </Link>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
