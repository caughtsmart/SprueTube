import { data, Link } from "react-router";
import { and, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/project";
import { Avatar } from "../components/Avatar";
import { Feed } from "../components/Feed";
import { getScope } from "../lib/data.server";
import { fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import { pickAd } from "../../server/services/ads";
import { getProjectPosts } from "../../server/services/feed";
import { block, profile, project } from "../../server/db/schema";
import {
  GAME_SYSTEM_LABELS,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.entry) return [{ title: "Build log — SprueTube" }];

  const { entry, owner } = loaded;
  const description =
    entry.summary ??
    `${owner.displayName}'s build log: ${entry.title}. ${entry.postCount} ${
      entry.postCount === 1 ? "entry" : "entries"
    } on SprueTube.`;

  return [
    { title: `${entry.title} — ${owner.displayName} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: entry.title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    ...(loaded.coverUrl
      ? [{ property: "og:image", content: loaded.coverUrl }]
      : []),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  if (!params.handle.startsWith("@")) {
    throw data({ message: "Page not found." }, { status: 404 });
  }
  const username = params.handle.slice(1);

  const owner = await scope.db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!owner || owner.status === "deleted") {
    throw data({ message: "No such painter." }, { status: 404 });
  }

  const viewerId = scope.viewer?.userId ?? null;
  const isOwner = viewerId === owner.userId;

  // A block hides the build log exactly as it hides the profile — otherwise
  // blocking someone would still leave a readable route to their work.
  if (viewerId && !isOwner) {
    const blocked = await scope.db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${owner.userId})
            or (${block.blockerId} = ${owner.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) {
      throw data({ message: "No such build log." }, { status: 404 });
    }
  }

  const entry = await scope.db.query.project.findFirst({
    where: and(
      eq(project.ownerId, owner.userId),
      eq(project.slug, params.slug),
    ),
  });
  if (!entry) {
    throw data({ message: "No such build log." }, { status: 404 });
  }

  const [page, ad] = await Promise.all([
    getProjectPosts(scope.db, entry.id, viewerId, owner.userId),
    pickAd(scope.db, "sidebar"),
  ]);

  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };

  return {
    entry: {
      id: entry.id,
      title: entry.title,
      slug: entry.slug,
      summary: entry.summary,
      gameSystem: entry.gameSystem,
      scale: entry.scale,
      status: entry.status as ProjectStatus,
      postCount: entry.postCount,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
    owner: {
      username: owner.username,
      displayName: owner.displayName,
      avatarImageId: owner.avatarImageId,
    },
    avatarUrl: imageSrc(config, owner.avatarImageId, "avatar"),
    coverUrl: imageSrc(config, entry.coverImageId, "full"),
    isOwner,
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad,
  };
}

export default function ProjectPage({ loaderData }: Route.ComponentProps) {
  const { entry, owner } = loaderData;

  const facts = [
    entry.gameSystem
      ? (GAME_SYSTEM_LABELS[
          entry.gameSystem as keyof typeof GAME_SYSTEM_LABELS
        ] ?? entry.gameSystem)
      : null,
    entry.scale,
    PROJECT_STATUS_LABELS[entry.status],
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl">
      {loaderData.coverUrl ? (
        <div
          className="st-card h-32 bg-cover bg-center sm:h-48"
          style={{ backgroundImage: `url(${loaderData.coverUrl})` }}
          role="img"
          aria-label={`Cover image for ${entry.title}`}
        />
      ) : null}

      <header className={loaderData.coverUrl ? "mt-4" : ""}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{entry.title}</h1>
            <Link
              to={`/@${owner.username}`}
              className="mt-2 inline-flex items-center gap-2"
            >
              <Avatar
                username={owner.username}
                src={loaderData.avatarUrl}
                size={32}
              />
              <span className="st-text-strong text-sm font-medium">
                {owner.displayName}
              </span>
              <span className="st-text-muted text-sm">@{owner.username}</span>
            </Link>
          </div>

          {loaderData.isOwner ? (
            <Link
              to={`/@${owner.username}/projects/${entry.slug}/edit`}
              className="st-btn st-btn-ghost shrink-0 text-sm"
            >
              Edit
            </Link>
          ) : null}
        </div>

        {entry.summary ? (
          <p className="mt-4 text-[0.9375rem] leading-relaxed">
            {entry.summary}
          </p>
        ) : null}

        <div className="st-text-muted mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
          <span>
            {entry.postCount} {entry.postCount === 1 ? "entry" : "entries"}
          </span>
          <span>started {fullDate(entry.createdAt)}</span>
        </div>
      </header>

      {/*
        Oldest first, which is the whole point of a build log — the interesting
        thing is the progression, and newest-first turns that into a stack of
        disconnected photos. Said out loud here because it contradicts every
        other listing on the site.
      */}
      <p className="st-text-muted mt-6 mb-2 text-xs">Oldest first</p>

      <Feed
        initialPosts={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint={`/projects/${owner.username}/${entry.slug}/posts`}
        ad={loaderData.ad}
        emptyState={
          <>
            <p className="text-4xl">🪛</p>
            <h2 className="mt-4 text-lg font-semibold">Nothing in here yet</h2>
            <p className="st-text-muted mt-2 text-sm">
              {loaderData.isOwner ? (
                <>
                  Post something and pick "{entry.title}" from the build log
                  dropdown to start the story.
                </>
              ) : (
                "This build log has not started yet."
              )}
            </p>
            {loaderData.isOwner ? (
              <Link to="/compose" className="st-btn st-btn-primary mt-4">
                Add the first entry
              </Link>
            ) : null}
          </>
        }
      />
    </div>
  );
}
