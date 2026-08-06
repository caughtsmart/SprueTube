import { Link } from "react-router";
import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/explore";
import { Feed } from "../components/Feed";
import { getScope } from "../lib/data.server";
import { compactCount } from "../lib/format";
import { pickAd } from "../../server/services/ads";
import { getFeed } from "../../server/services/feed";
import { profile, tag } from "../../server/db/schema";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Explore — SprueTube" },
    {
      name: "description",
      content:
        "Find miniature painters and model makers to follow, browse by game system, and see what the community is working on right now.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  const [page, tags, newcomers, ad] = await Promise.all([
    getFeed(scope.db, {
      tab: "discover",
      viewerId: scope.viewer?.userId ?? null,
    }),
    scope.db
      .select({ name: tag.name, postCount: tag.postCount })
      .from(tag)
      .orderBy(desc(tag.postCount))
      .limit(20),
    scope.db
      .select({
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
        bio: profile.bio,
        postCount: profile.postCount,
      })
      .from(profile)
      .where(eq(profile.status, "active"))
      .orderBy(desc(profile.postCount))
      .limit(8),
    pickAd(scope.db, "feed"),
  ]);

  return {
    posts: page.posts,
    nextCursor: page.nextCursor,
    tags: tags.filter((t) => t.postCount > 0),
    newcomers: newcomers.filter((p) => p.postCount > 0),
    ad,
  };
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Explore</h1>

      <section className="mb-6" aria-label="Browse by game system">
        <h2 className="st-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          By game or subject
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {GAME_SYSTEMS.filter((system) => system !== "other").map((system) => (
            <Link key={system} to={`/systems/${system}`} className="st-chip">
              {GAME_SYSTEM_LABELS[system]}
            </Link>
          ))}
        </div>
      </section>

      {loaderData.tags.length ? (
        <section className="mb-6" aria-label="Popular tags">
          <h2 className="st-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
            Busy tags
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {loaderData.tags.map((entry) => (
              <Link
                key={entry.name}
                to={`/tags/${entry.name}`}
                className="st-chip"
              >
                #{entry.name}
                <span className="opacity-60">
                  {compactCount(entry.postCount)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {loaderData.newcomers.length ? (
        <section className="mb-6" aria-label="People to follow">
          <h2 className="st-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
            People posting work
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {loaderData.newcomers.map((person) => (
              <li key={person.username} className="st-card p-3">
                <Link
                  to={`/@${person.username}`}
                  className="st-text-strong text-sm font-semibold hover:underline"
                >
                  {person.displayName}
                </Link>
                <p className="st-text-muted text-xs">@{person.username}</p>
                {person.bio ? (
                  <p className="st-text-muted mt-1 line-clamp-2 text-xs">
                    {person.bio}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">What is getting attention</h2>
      <Feed
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint="/feed?tab=discover"
        ad={loaderData.ad}
      />
    </div>
  );
}
