import { useState } from "react";
import { data, Link } from "react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/profile";
import { Avatar } from "../components/Avatar";
import { Feed } from "../components/Feed";
import { ReportButton } from "../components/ReportButton";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { compactCount, fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { pickAd } from "../../server/services/ads";
import { getProfilePosts } from "../../server/services/feed";
import { block, follow, profile, project } from "../../server/db/schema";
import {
  GAME_SYSTEM_LABELS,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.person) return [{ title: "Profile — SprueTube" }];

  const { person } = loaded;
  const description =
    person.bio ??
    `${person.displayName} paints and builds models. See their work on SprueTube.`;

  return [
    { title: `${person.displayName} (@${person.username}) — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: `${person.displayName} on SprueTube` },
    { property: "og:description", content: description },
    { property: "og:type", content: "profile" },
    ...(loaded.avatarUrl
      ? [{ property: "og:image", content: loaded.avatarUrl }]
      : []),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  // The '@' is part of the matched segment, not a route prefix. Anything that
  // reaches here without it is a bad URL, not a profile.
  if (!params.handle.startsWith("@")) {
    throw data({ message: "Page not found." }, { status: 404 });
  }
  const username = params.handle.slice(1);

  const row = await scope.db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!row || row.status === "deleted") {
    throw data({ message: "No such painter." }, { status: 404 });
  }

  const viewerId = scope.viewer?.userId ?? null;
  const isSelf = viewerId === row.userId;

  // A block hides the profile in both directions.
  if (viewerId && !isSelf) {
    const blocked = await scope.db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${row.userId})
            or (${block.blockerId} = ${row.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) {
      throw data({ message: "No such painter." }, { status: 404 });
    }
  }

  const [page, projects, relationship, ad] = await Promise.all([
    getProfilePosts(scope.db, row.userId, viewerId),
    scope.db
      .select()
      .from(project)
      .where(eq(project.ownerId, row.userId))
      .orderBy(desc(project.updatedAt))
      .limit(12),
    viewerId && !isSelf
      ? scope.db
          .select({ followerId: follow.followerId })
          .from(follow)
          .where(
            and(
              eq(follow.followerId, viewerId),
              eq(follow.followeeId, row.userId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    pickAd(scope.db, "sidebar"),
  ]);

  return {
    person: {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      bio: row.bio,
      location: row.location,
      websiteUrl: row.websiteUrl,
      pronouns: row.pronouns,
      systems: row.systems ?? [],
      followerCount: row.followerCount,
      followingCount: row.followingCount,
      postCount: row.postCount,
      createdAt: row.createdAt,
      suspended: row.status === "suspended",
    },
    avatarUrl: imageSrc(
      { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH },
      row.avatarImageId,
      "avatar",
    ),
    bannerUrl: imageSrc(
      { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH },
      row.bannerImageId,
      "full",
    ),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      postCount: p.postCount,
      status: p.status,
    })),
    isSelf,
    initiallyFollowing: relationship.length > 0,
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad,
  };
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { viewer } = useRoot();
  const { person } = loaderData;
  const [following, setFollowing] = useState(loaderData.initiallyFollowing);
  const [followerCount, setFollowerCount] = useState(person.followerCount);
  const [busy, setBusy] = useState(false);

  async function toggleFollow() {
    if (!viewer) {
      window.location.href = `/login?next=/@${person.username}`;
      return;
    }
    setBusy(true);
    const next = !following;
    setFollowing(next);
    setFollowerCount((count) => count + (next ? 1 : -1));

    try {
      if (next) await api.post(`/profiles/${person.username}/follow`);
      else await api.delete(`/profiles/${person.username}/follow`);
    } catch {
      setFollowing(!next);
      setFollowerCount((count) => count + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }

  if (person.suspended) {
    return (
      <div className="st-card mx-auto max-w-2xl p-10 text-center">
        <div aria-hidden className="st-hazard-muted mx-auto h-2.5 w-32 rounded-sm" />
        <h1 className="mt-4 text-lg font-semibold">Account suspended</h1>
        <p className="st-text-muted mt-2 text-sm">
          This account has been suspended for breaking the community rules.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="st-card overflow-hidden">
        <div
          className="h-28 sm:h-40"
          style={
            loaderData.bannerUrl
              ? {
                  backgroundImage: `url(${loaderData.bannerUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  background:
                    "linear-gradient(120deg, var(--color-sprue-800), var(--color-sprue-700))",
                }
          }
        />

        <div className="p-4">
          <div className="-mt-12 flex items-end justify-between gap-3">
            <span className="rounded-full ring-4 ring-[var(--surface-card)]">
              <Avatar
                username={person.username}
                src={loaderData.avatarUrl}
                size={76}
              />
            </span>

            <div className="flex items-center gap-2">
              {loaderData.isSelf ? (
                <Link to="/settings" className="st-btn st-btn-ghost text-sm">
                  Edit profile
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleFollow}
                    disabled={busy}
                    className={`st-btn text-sm ${
                      following ? "st-btn-ghost" : "st-btn-primary"
                    }`}
                  >
                    {following ? "Following" : "Follow"}
                  </button>
                  <ReportButton
                    subjectType="user"
                    subjectId={person.userId}
                  />
                </>
              )}
            </div>
          </div>

          <h1 className="mt-3 text-xl font-bold">{person.displayName}</h1>
          <p className="st-text-muted text-sm">
            @{person.username}
            {person.pronouns ? ` · ${person.pronouns}` : ""}
          </p>

          {person.bio ? (
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">
              {person.bio}
            </p>
          ) : null}

          <div className="st-text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {person.location ? <span>📍 {person.location}</span> : null}
            {person.websiteUrl ? (
              <a
                href={person.websiteUrl}
                rel="nofollow ugc noopener noreferrer"
                target="_blank"
                className="st-link"
              >
                {person.websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            <span>Joined {fullDate(person.createdAt)}</span>
          </div>

          {person.systems.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {person.systems.map((system) => (
                <Link
                  key={system}
                  to={`/systems/${system}`}
                  className="st-chip"
                >
                  {GAME_SYSTEM_LABELS[
                    system as keyof typeof GAME_SYSTEM_LABELS
                  ] ?? system}
                </Link>
              ))}
            </div>
          ) : null}

          <dl className="mt-4 flex gap-5 text-sm">
            <Stat label="posts" value={person.postCount} />
            <Stat label="followers" value={followerCount} />
            <Stat label="following" value={person.followingCount} />
          </dl>
        </div>
      </header>

      {loaderData.projects.length || loaderData.isSelf ? (
        <section className="mt-5" aria-label="Build logs">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Build logs</h2>
            {loaderData.isSelf ? (
              <Link to="/projects/new" className="st-link text-xs font-medium">
                New build log
              </Link>
            ) : null}
          </div>

          {loaderData.projects.length ? (
            <ul className="flex flex-wrap gap-2">
              {loaderData.projects.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={`/@${person.username}/projects/${entry.slug}`}
                    className="st-card block px-3 py-2 transition hover:border-[var(--color-primer-500)]"
                  >
                    <p className="text-sm font-medium">{entry.title}</p>
                    <p className="st-text-muted text-xs">
                      {entry.postCount}{" "}
                      {entry.postCount === 1 ? "entry" : "entries"} ·{" "}
                      {PROJECT_STATUS_LABELS[entry.status as ProjectStatus] ??
                        entry.status}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="st-text-muted text-sm">
              Group a long build into one place — an army, a single model, or
              something you keep coming back to.
            </p>
          )}
        </section>
      ) : null}

      <section className="mt-5">
        <Feed
          initialPosts={loaderData.posts}
          initialCursor={loaderData.nextCursor}
          endpoint={`/profiles/${person.username}/posts`}
          ad={loaderData.ad}
          emptyState={
            <>
              <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
              <h2 className="mt-4 text-lg font-semibold">Nothing posted yet</h2>
              <p className="st-text-muted mt-2 text-sm">
                {loaderData.isSelf
                  ? "Your first post can be a blurry photo of a half-built kit. That is the point."
                  : "Nothing on the workbench just yet."}
              </p>
            </>
          }
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1">
      <dt className="sr-only">{label}</dt>
      <dd className="st-text-strong font-semibold">{compactCount(value)}</dd>
      <span className="st-text-muted">{label}</span>
    </div>
  );
}
