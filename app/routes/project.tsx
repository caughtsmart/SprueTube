import { data, Link } from "react-router";
import { and, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/project";
import { Avatar } from "../components/Avatar";
import { ImageComments } from "../components/ImageComments";
import { PostCard } from "../components/PostCard";
import { ProjectComments } from "../components/ProjectComments";
import { ProjectEntries } from "../components/ProjectEntries";
import { ProjectReorder } from "../components/ProjectReorder";
import { getScope } from "../lib/data.server";
import { fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import { pickAd } from "../../server/services/ads";
import { getPost } from "../../server/services/feed";
import {
  getEntryOrder,
  getMediaComments,
  getProjectComments,
  getProjectEntries,
  groupCommentsByMedia,
  threadComments,
} from "../../server/services/projects";
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

  const [page, ad, commentRows, entryOrder] = await Promise.all([
    getProjectEntries(scope.db, {
      projectId: entry.id,
      ownerId: owner.userId,
      viewerId,
      projectRef: { id: entry.id, title: entry.title, slug: entry.slug },
    }),
    pickAd(scope.db, "sidebar"),
    getProjectComments(scope.db, entry.id),
    // Only the owner can reorder, so only the owner pays for the list.
    isOwner ? getEntryOrder(scope.db, entry.id) : Promise.resolve([]),
  ]);

  /*
   * The pinned entry goes through getPost rather than being read straight from
   * the page it is already on, because getPost is where the visibility rules
   * live. A pin left on an entry that has since gone private or been removed
   * must disappear for everyone but the owner, and this is what makes that
   * true without a second copy of the rules.
   */
  const pinned = entry.pinnedPostId
    ? await getPost(scope.db, entry.pinnedPostId, viewerId)
    : null;

  const pinnedImageComments = groupCommentsByMedia(
    pinned ? await getMediaComments(scope.db, pinned.id) : [],
  );

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
      commentCount: entry.commentCount,
      pinnedPostId: entry.pinnedPostId,
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
    pinned,
    pinnedImageThreads: (pinned?.media ?? []).map((image) => ({
      mediaId: image.id,
      comments: threadComments(pinnedImageComments.get(image.id) ?? []),
    })),
    entryOrder,
    comments: threadComments(commentRows),
    posts: page.posts,
    nextCursor: page.nextCursor,
    ad,
  };
}

export default function ProjectPage({ loaderData }: Route.ComponentProps) {
  const { entry, owner, pinned } = loaderData;

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
        The pinned entry, above the history.

        A build log reads oldest first, which is right for the story and wrong
        for the question most visitors actually arrive with: what does it look
        like now? Answering that at the top costs one card and saves them
        scrolling two years to find out.
      */}
      {pinned ? (
        <section className="mt-6" aria-label="Where this project is now">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="st-text-strong text-sm font-semibold">
              📌 Where it is now
            </h2>
            <span className="st-text-muted text-xs">
              Pinned by {loaderData.isOwner ? "you" : owner.displayName}
            </span>
          </div>

          <PostCard post={pinned} />

          <ImageComments
            postId={pinned.id}
            images={pinned.media}
            threads={loaderData.pinnedImageThreads}
            sensitive={pinned.sensitive}
          />
        </section>
      ) : null}

      {loaderData.isOwner ? (
        <ProjectReorder projectId={entry.id} entries={loaderData.entryOrder} />
      ) : null}

      {/*
        Oldest first, which is the whole point of a build log — the interesting
        thing is the progression, and newest-first turns that into a stack of
        disconnected photos. Said out loud here because it contradicts every
        other listing on the site.

        The owner can override it entry by entry; anything they have not moved
        still falls where its date puts it.
      */}
      <p className="st-text-muted mt-6 mb-2 text-xs">
        {pinned ? "The whole log, oldest first" : "Oldest first"}
      </p>

      <ProjectEntries
        initialEntries={loaderData.posts}
        initialCursor={loaderData.nextCursor}
        endpoint={`/projects/${owner.username}/${entry.slug}/entries`}
        ad={loaderData.ad}
        isOwner={loaderData.isOwner}
        projectId={entry.id}
        pinnedPostId={entry.pinnedPostId}
        emptyState={
          <>
            <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
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

      <ProjectComments
        projectId={entry.id}
        commentCount={entry.commentCount}
        comments={loaderData.comments}
      />
    </div>
  );
}
