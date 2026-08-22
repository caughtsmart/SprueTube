import { useState } from "react";
import { Link } from "react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/explore";
import { Avatar } from "../components/Avatar";
import { Feed } from "../components/Feed";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { compactCount } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { pickAd } from "../../server/services/ads";
import { getActiveChallenges } from "../../server/services/challenges";
import { getTopCreators } from "../../server/services/discovery";
import { getFeed } from "../../server/services/feed";
import { listPins } from "../../server/services/pins";
import { getPopularRecipes } from "../../server/services/recipes";
import { follow, profile, tag } from "../../server/db/schema";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Explore — SprueTube" },
    {
      name: "description",
      content:
        "The best of SprueTube: top painters, the work getting attention right now, current painting challenges, and everything to browse by game and theme.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const viewerId = scope.viewer?.userId ?? null;

  const [page, creators, challenges, pins, tags, popularRecipes, ad] =
    await Promise.all([
      getFeed(scope.db, { tab: "discover", viewerId }),
      getTopCreators(scope.env, scope.db, {
        viewerId,
        waitUntil: (promise) => scope.ctx.waitUntil(promise),
      }),
      getActiveChallenges(scope.db),
      listPins(scope.db, viewerId),
      scope.db
        .select({ name: tag.name, postCount: tag.postCount })
        .from(tag)
        .orderBy(desc(tag.postCount))
        .limit(24),
      getPopularRecipes(scope.env, scope.db, {
        viewerId,
        waitUntil: (promise) => scope.ctx.waitUntil(promise),
      }),
      pickAd(scope.db, "feed"),
    ]);

  // Which of the shown creators the viewer already follows — one small query
  // rather than baking a per-viewer answer into the cached creator list.
  let followed = new Set<string>();
  if (viewerId && creators.length) {
    const rows = await scope.db
      .select({ id: follow.followeeId })
      .from(follow)
      .where(
        and(
          eq(follow.followerId, viewerId),
          inArray(
            follow.followeeId,
            creators.map((c) => c.userId),
          ),
        ),
      );
    followed = new Set(rows.map((r) => r.id));
  }

  return {
    signedIn: Boolean(viewerId),
    posts: page.posts,
    nextCursor: page.nextCursor,
    creators: creators.map((c) => ({
      username: c.username,
      displayName: c.displayName,
      avatarImageId: c.avatarImageId,
      bio: c.bio,
      followerCount: c.followerCount,
      postsCounted: c.postsCounted,
      weeksActive: c.weeksActive,
      sampleImageId: c.sampleImageId,
      viewerFollows: followed.has(c.userId),
    })),
    challenges,
    pins,
    tags: tags.filter((t) => t.postCount > 0),
    popularRecipes,
    ad,
  };
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const signedIn = loaderData.signedIn;

  // Pins are the one bit of state the page owns: toggling one should not reload
  // the route. Seeded from the loader, then kept in sync optimistically.
  const [pinnedSystems, setPinnedSystems] = useState<Set<string>>(
    () => new Set(loaderData.pins.systems),
  );
  const [pinnedTags, setPinnedTags] = useState<Set<string>>(
    () => new Set(loaderData.pins.tags),
  );

  async function togglePin(kind: "system" | "tag", value: string) {
    const set = kind === "system" ? pinnedSystems : pinnedTags;
    const setState = kind === "system" ? setPinnedSystems : setPinnedTags;
    const on = !set.has(value);

    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    setState(next);

    try {
      if (on) await api.post("/pins", { kind, value });
      else await api.delete("/pins", { kind, value });
    } catch {
      // Put it back if the write failed.
      const revert = new Set(next);
      if (on) revert.delete(value);
      else revert.add(value);
      setState(revert);
    }
  }

  const hasPins = pinnedSystems.size > 0 || pinnedTags.size > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Explore</h1>
      <p className="st-text-muted mb-5 text-sm">
        The painters and the work worth a look right now.
      </p>

      {signedIn && hasPins ? (
        <YourShortcuts
          systems={[...pinnedSystems]}
          tags={[...pinnedTags]}
          onUnpin={togglePin}
        />
      ) : null}

      {loaderData.challenges.length ? (
        <Challenges challenges={loaderData.challenges} />
      ) : null}

      {loaderData.creators.length ? (
        <TopCreators creators={loaderData.creators} />
      ) : null}

      <BrowseSection
        heading="By game or subject"
        items={GAME_SYSTEMS.filter((s) => s !== "other").map((system) => ({
          value: system,
          label: GAME_SYSTEM_LABELS[system],
          href: `/systems/${system}`,
        }))}
        kind="system"
        pinned={pinnedSystems}
        signedIn={signedIn}
        onTogglePin={togglePin}
      />

      {loaderData.tags.length ? (
        <BrowseSection
          heading="Busy tags"
          items={loaderData.tags.map((entry) => ({
            value: entry.name,
            label: `#${entry.name}`,
            href: `/tags/${entry.name}`,
            count: entry.postCount,
          }))}
          kind="tag"
          pinned={pinnedTags}
          signedIn={signedIn}
          onTogglePin={togglePin}
        />
      ) : null}

      {loaderData.popularRecipes.length ? (
        <section className="mb-6" aria-label="Popular recipes">
          <SectionHeading>Recipes people are keeping</SectionHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {loaderData.popularRecipes.map((recipe) => (
              <li key={recipe.id} className="st-card p-3">
                <Link
                  to={`/@${recipe.ownerUsername}/recipes/${recipe.slug}`}
                  className="st-text-strong text-sm font-semibold hover:underline"
                >
                  🎨 {recipe.title}
                </Link>
                <p className="st-text-muted mt-0.5 text-xs">
                  by {recipe.ownerDisplayName} ·{" "}
                  {recipe.saveCount + recipe.forkCount === 1
                    ? "1 keep"
                    : `${recipe.saveCount + recipe.forkCount} keeps`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">Getting attention</h2>
      <Feed
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint="/feed?tab=discover"
        ad={loaderData.ad}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="st-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

type CreatorCard = Route.ComponentProps["loaderData"]["creators"][number];

function TopCreators({ creators }: { creators: CreatorCard[] }) {
  return (
    <section className="mb-6" aria-label="Top painters">
      <SectionHeading>Top painters right now</SectionHeading>
      <ul className="grid gap-3 sm:grid-cols-2">
        {creators.map((creator) => (
          <CreatorRow key={creator.username} creator={creator} />
        ))}
      </ul>
    </section>
  );
}

function CreatorRow({ creator }: { creator: CreatorCard }) {
  const { viewer, config } = useRoot();
  const [following, setFollowing] = useState(creator.viewerFollows);
  const isSelf = viewer?.username === creator.username;

  async function toggleFollow() {
    if (!viewer) {
      window.location.href = "/login";
      return;
    }
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/profiles/${creator.username}/follow`);
      else await api.delete(`/profiles/${creator.username}/follow`);
    } catch {
      setFollowing(!next);
    }
  }

  const sample = imageSrc(config, creator.sampleImageId, "thumbnail");

  return (
    <li className="st-card flex gap-3 p-3">
      <Link to={`/@${creator.username}`} className="shrink-0">
        <Avatar
          username={creator.username}
          src={imageSrc(config, creator.avatarImageId, "avatar")}
          size={44}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/@${creator.username}`}
          className="st-text-strong block truncate text-sm font-semibold hover:underline"
        >
          {creator.displayName}
        </Link>
        <p className="st-text-muted truncate text-xs">
          {compactCount(creator.followerCount)}{" "}
          {creator.followerCount === 1 ? "follower" : "followers"}
          {creator.weeksActive > 1 ? (
            <> · active {creator.weeksActive} of the last 6 weeks</>
          ) : null}
        </p>
        {creator.bio ? (
          <p className="st-text-muted mt-1 line-clamp-2 text-xs">
            {creator.bio}
          </p>
        ) : null}

        {!isSelf ? (
          <button
            type="button"
            onClick={toggleFollow}
            className={[
              "st-btn mt-2 px-3 py-1 text-xs",
              following ? "st-btn-ghost" : "st-btn-primary",
            ].join(" ")}
          >
            {following ? "Following" : "Follow"}
          </button>
        ) : (
          <p className="st-text-muted mt-2 text-xs">This is you</p>
        )}
      </div>

      {sample ? (
        <Link
          to={`/@${creator.username}`}
          className="hidden shrink-0 overflow-hidden rounded-md sm:block"
          aria-hidden
          tabIndex={-1}
        >
          <img
            src={sample}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-16 w-16 object-cover"
          />
        </Link>
      ) : null}
    </li>
  );
}

type ActiveChallenge =
  Route.ComponentProps["loaderData"]["challenges"][number];

function Challenges({ challenges }: { challenges: ActiveChallenge[] }) {
  return (
    <section className="mb-6" aria-label="Painting challenges">
      <SectionHeading>Painting challenges</SectionHeading>
      <ul className="flex flex-col gap-2">
        {challenges.map((challenge) => (
          <li key={challenge.id} className="st-card flex overflow-hidden">
            <span aria-hidden className="st-hazard-rail" />
            <div className="min-w-0 flex-1 p-3">
              <h3 className="text-sm font-semibold">{challenge.title}</h3>
              <p className="st-text-muted mt-1 text-sm leading-relaxed">
                {challenge.prompt}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <Link
                  to={`/tags/${challenge.tag}`}
                  className="st-link font-medium"
                >
                  See entries · #{challenge.tag}
                </Link>
                {challenge.entryCount > 0 ? (
                  <span className="st-text-muted">
                    {compactCount(challenge.entryCount)}{" "}
                    {challenge.entryCount === 1 ? "post" : "posts"}
                  </span>
                ) : null}
                <Link to="/compose" className="st-text-muted hover:underline">
                  Enter with #{challenge.tag}
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function YourShortcuts({
  systems,
  tags,
  onUnpin,
}: {
  systems: string[];
  tags: string[];
  onUnpin: (kind: "system" | "tag", value: string) => void;
}) {
  return (
    <section className="mb-6" aria-label="Your pinned shortcuts">
      <SectionHeading>Your shortcuts</SectionHeading>
      <div className="flex flex-wrap gap-1.5">
        {systems.map((system) => (
          <span key={`s-${system}`} className="st-chip">
            <Link to={`/systems/${system}`} className="hover:underline">
              {GAME_SYSTEM_LABELS[system as keyof typeof GAME_SYSTEM_LABELS] ??
                system}
            </Link>
            <button
              type="button"
              onClick={() => onUnpin("system", system)}
              aria-label={`Unpin ${system}`}
              className="ml-1 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        {tags.map((tagName) => (
          <span key={`t-${tagName}`} className="st-chip">
            <Link to={`/tags/${tagName}`} className="hover:underline">
              #{tagName}
            </Link>
            <button
              type="button"
              onClick={() => onUnpin("tag", tagName)}
              aria-label={`Unpin ${tagName}`}
              className="ml-1 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function BrowseSection({
  heading,
  items,
  kind,
  pinned,
  signedIn,
  onTogglePin,
}: {
  heading: string;
  items: { value: string; label: string; href: string; count?: number }[];
  kind: "system" | "tag";
  pinned: Set<string>;
  signedIn: boolean;
  onTogglePin: (kind: "system" | "tag", value: string) => void;
}) {
  return (
    <section className="mb-6" aria-label={heading}>
      <SectionHeading>{heading}</SectionHeading>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const isPinned = pinned.has(item.value);
          return (
            <span
              key={item.value}
              className={[
                "st-chip",
                isPinned ? "st-text-strong ring-1 ring-[var(--color-primer-500)]" : "",
              ].join(" ")}
            >
              <Link to={item.href} className="hover:underline">
                {item.label}
              </Link>
              {item.count != null ? (
                <span className="opacity-60">{compactCount(item.count)}</span>
              ) : null}
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => onTogglePin(kind, item.value)}
                  aria-label={isPinned ? `Unpin ${item.value}` : `Pin ${item.value}`}
                  aria-pressed={isPinned}
                  title={isPinned ? "Unpin" : "Pin to your shortcuts"}
                  className="ml-0.5 leading-none"
                >
                  {isPinned ? "★" : "☆"}
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}
