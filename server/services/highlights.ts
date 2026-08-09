/*
 * Homepage highlights — the best work on the site rather than the newest.
 *
 * Two lists, both small:
 *
 *   1. Build logs, ranked by the likes their posts have collected between them.
 *      A project has no like count of its own, and giving it one would mean a
 *      counter to keep in step with every like, unlike and deleted post; the
 *      sum is cheap enough to compute every quarter of an hour instead.
 *   2. Individual photographs. `post_media` carries no likes either — likes land
 *      on the post — so a photograph inherits its post's count and we show one
 *      image per post. That keeps the section a wall of models rather than a
 *      leaderboard of posts, which is the whole point of it.
 *
 * Both run on every homepage load, so the computed lists live in KV for fifteen
 * minutes. The cache is viewer-independent: it holds a few more candidates than
 * are shown, and the viewer's blocks and mutes are applied to that short list
 * afterwards. That is two small indexed queries per signed-in load instead of a
 * cache entry per person.
 */

import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import { block, mute, post, postMedia, profile, project } from "../db/schema";

export type HighlightProject = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  coverImageId: string | null;
  /** Likes summed across the posts counted below, not across all time forever. */
  likeTotal: number;
  postsCounted: number;
  owner: { userId: string; username: string; displayName: string };
};

export type HighlightImage = {
  postId: string;
  mediaId: string;
  imageId: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  /** The post's like count. See the note at the top of the file. */
  likeCount: number;
  author: { userId: string; username: string; displayName: string };
};

export type Highlights = {
  projects: HighlightProject[];
  images: HighlightImage[];
};

export const HIGHLIGHTS_CACHE_KEY = "highlights:v1";
export const HIGHLIGHTS_TTL_SECONDS = 15 * 60;

/** How many are shown. Deliberately few — this is a homepage, not a chart. */
export const SHOWN_PROJECTS = 3;
export const SHOWN_IMAGES = 6;

/**
 * How many are cached. The surplus is what makes the per-viewer block filter
 * free: someone who has blocked one of the six painters still sees six.
 */
const CANDIDATE_PROJECTS = 8;
const CANDIDATE_IMAGES = 18;

/** Nobody gets more than this many photographs in the strip. */
const MAX_PER_AUTHOR = 2;

const EMPTY: Highlights = { projects: [], images: [] };

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function getHighlights(
  env: Env,
  db: Db,
  options: {
    viewerId?: string | null;
    /** Pass `ctx.waitUntil` so a cache miss does not wait on the KV write. */
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
): Promise<Highlights> {
  try {
    const cached = await readCache(env);
    const all = cached ?? (await computeHighlights(db));

    if (!cached) {
      const write = writeCache(env, all);
      if (options.waitUntil) options.waitUntil(write);
      else await write;
    }

    const hidden = await hiddenAmong(
      db,
      options.viewerId ?? null,
      authorIdsIn(all),
    );
    const visible = hidden.size ? filterHidden(all, hidden) : all;

    return {
      projects: visible.projects.slice(0, SHOWN_PROJECTS),
      images: visible.images.slice(0, SHOWN_IMAGES),
    };
  } catch {
    // A homepage missing its highlights is a much smaller problem than a
    // homepage that will not render, and neither list is load-bearing.
    return EMPTY;
  }
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

async function readCache(env: Env): Promise<Highlights | null> {
  const cached = await env.CACHE.get(HIGHLIGHTS_CACHE_KEY, "json");
  // The key carries a version, so a shape change invalidates rather than
  // migrates. This only guards against a truncated or hand-edited value.
  if (!cached || typeof cached !== "object") return null;
  const value = cached as Partial<Highlights>;
  if (!Array.isArray(value.projects) || !Array.isArray(value.images)) {
    return null;
  }
  return { projects: value.projects, images: value.images };
}

function writeCache(env: Env, highlights: Highlights) {
  return env.CACHE.put(HIGHLIGHTS_CACHE_KEY, JSON.stringify(highlights), {
    expirationTtl: HIGHLIGHTS_TTL_SECONDS,
  });
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

async function computeHighlights(db: Db): Promise<Highlights> {
  const [projects, images] = await Promise.all([
    topProjects(db),
    topImages(db),
  ]);
  return { projects, images };
}

async function topProjects(db: Db): Promise<HighlightProject[]> {
  const likeTotal = sql<number>`sum(${post.likeCount})`;
  const postsCounted = sql<number>`count(*)`;

  // Grouped over post(project_id, …), which the project index covers. Only
  // public published posts are counted: a followers-only post's likes are not
  // ours to advertise, and the totals should match what a visitor can go and
  // read for themselves.
  const totals = await db
    .select({ projectId: post.projectId, likeTotal, postsCounted })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .where(
      and(
        isNotNull(post.projectId),
        eq(post.status, "published"),
        isNull(post.deletedAt),
        eq(post.visibility, "public"),
        eq(profile.status, "active"),
      ),
    )
    .groupBy(post.projectId)
    .orderBy(desc(likeTotal))
    .limit(CANDIDATE_PROJECTS * 2);

  const ids = [
    ...new Set(
      totals.map((row) => row.projectId).filter((id): id is string => !!id),
    ),
  ];
  if (!ids.length) return [];

  const projects = await db
    .select({
      id: project.id,
      title: project.title,
      slug: project.slug,
      summary: project.summary,
      coverImageId: project.coverImageId,
      ownerId: profile.userId,
      ownerUsername: profile.username,
      ownerDisplayName: profile.displayName,
    })
    .from(project)
    .innerJoin(profile, eq(profile.userId, project.ownerId))
    .where(and(inArray(project.id, ids), eq(profile.status, "active")));

  // A build log with no cover borrows the newest photograph in it. Only asked
  // for when it is actually needed, so the common case costs nothing.
  const needCover = projects
    .filter((row) => !row.coverImageId)
    .map((row) => row.id);

  const coverFallbacks = needCover.length
    ? await db
        .select({
          projectId: post.projectId,
          imageId: postMedia.imageId,
          position: postMedia.position,
          createdAt: post.createdAt,
        })
        .from(post)
        .innerJoin(postMedia, eq(postMedia.postId, post.id))
        .where(
          and(
            inArray(post.projectId, needCover),
            eq(post.status, "published"),
            isNull(post.deletedAt),
            eq(post.visibility, "public"),
            eq(post.sensitive, false),
          ),
        )
        .orderBy(desc(post.createdAt))
        .limit(60)
    : [];

  return assembleProjectHighlights({
    totals: totals.map((row) => ({
      projectId: row.projectId,
      likeTotal: Number(row.likeTotal ?? 0),
      postsCounted: Number(row.postsCounted ?? 0),
    })),
    projects,
    coverFallbacks,
    limit: CANDIDATE_PROJECTS,
  });
}

async function topImages(db: Db): Promise<HighlightImage[]> {
  // post(status, like_count) orders this without a sort; the remaining
  // predicates only thin the rows it walks.
  const posts = await db
    .select({
      postId: post.id,
      likeCount: post.likeCount,
      authorId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .where(
      and(
        eq(post.status, "published"),
        isNull(post.deletedAt),
        eq(post.visibility, "public"),
        eq(post.sensitive, false),
        eq(post.kind, "images"),
        eq(profile.status, "active"),
        gt(post.likeCount, 0),
      ),
    )
    .orderBy(desc(post.likeCount), desc(post.id))
    // Headroom: some of these lose their media to a later delete, and the
    // per-author cap discards more.
    .limit(CANDIDATE_IMAGES * 3);

  if (!posts.length) return [];

  const media = await db
    .select({
      id: postMedia.id,
      postId: postMedia.postId,
      imageId: postMedia.imageId,
      position: postMedia.position,
      width: postMedia.width,
      height: postMedia.height,
      altText: postMedia.altText,
    })
    .from(postMedia)
    .where(
      inArray(
        postMedia.postId,
        posts.map((row) => row.postId),
      ),
    );

  return assembleImageHighlights({
    posts,
    media,
    limit: CANDIDATE_IMAGES,
    maxPerAuthor: MAX_PER_AUTHOR,
  });
}

/**
 * Which of `ids` the viewer must not see: anyone they blocked, anyone who
 * blocked them, anyone they muted.
 *
 * Bounded by the cached candidate list rather than by the viewer's whole block
 * list, so this stays two indexed lookups over a couple of dozen ids however
 * many people they have blocked.
 */
async function hiddenAmong(
  db: Db,
  viewerId: string | null,
  ids: string[],
): Promise<Set<string>> {
  if (!viewerId || !ids.length) return new Set();

  const [blocks, mutes] = await Promise.all([
    db
      .select({ blockerId: block.blockerId, blockedId: block.blockedId })
      .from(block)
      .where(
        or(
          and(eq(block.blockerId, viewerId), inArray(block.blockedId, ids)),
          and(eq(block.blockedId, viewerId), inArray(block.blockerId, ids)),
        ),
      ),
    db
      .select({ id: mute.mutedId })
      .from(mute)
      .where(and(eq(mute.muterId, viewerId), inArray(mute.mutedId, ids))),
  ]);

  const hidden = new Set(mutes.map((row) => row.id));
  for (const row of blocks) {
    hidden.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
  }
  return hidden;
}

/* -------------------------------------------------------------------------- */
/* Pure assembly                                                              */
/* -------------------------------------------------------------------------- */

export type ProjectTotalRow = {
  projectId: string | null;
  likeTotal: number;
  postsCounted: number;
};

export type ProjectRow = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  coverImageId: string | null;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string;
};

export type ProjectCoverRow = {
  projectId: string | null;
  imageId: string;
  position: number;
  createdAt: number;
};

/**
 * Joins the like totals to the projects they belong to.
 *
 * A total with no matching project row means the owner is suspended or the
 * project is gone — the project query filtered it out — so it is dropped rather
 * than rendered as a gap.
 */
export function assembleProjectHighlights(input: {
  totals: ProjectTotalRow[];
  projects: ProjectRow[];
  coverFallbacks: ProjectCoverRow[];
  limit: number;
}): HighlightProject[] {
  const byId = new Map(input.projects.map((row) => [row.id, row]));
  const covers = bestCoverByProject(input.coverFallbacks);

  const out: HighlightProject[] = [];
  for (const total of input.totals) {
    if (!total.projectId || total.likeTotal <= 0) continue;
    const row = byId.get(total.projectId);
    if (!row) continue;

    out.push({
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      coverImageId: row.coverImageId ?? covers.get(row.id) ?? null,
      likeTotal: total.likeTotal,
      postsCounted: total.postsCounted,
      owner: {
        userId: row.ownerId,
        username: row.ownerUsername,
        displayName: row.ownerDisplayName,
      },
    });
  }

  // Sorted here rather than trusted from SQL, so the ordering is testable and
  // the same whatever order the rows arrive in.
  out.sort((a, b) => b.likeTotal - a.likeTotal || a.id.localeCompare(b.id));
  return out.slice(0, input.limit);
}

/** Newest photograph in each project, first image of that post. */
function bestCoverByProject(rows: ProjectCoverRow[]): Map<string, string> {
  const best = new Map<string, ProjectCoverRow>();
  for (const row of rows) {
    if (!row.projectId) continue;
    const current = best.get(row.projectId);
    if (
      !current ||
      row.createdAt > current.createdAt ||
      (row.createdAt === current.createdAt && row.position < current.position)
    ) {
      best.set(row.projectId, row);
    }
  }
  return new Map([...best].map(([id, row]) => [id, row.imageId]));
}

export type ImagePostRow = {
  postId: string;
  likeCount: number;
  authorId: string;
  username: string;
  displayName: string;
};

export type ImageMediaRow = {
  id: string;
  postId: string;
  imageId: string;
  position: number;
  width: number | null;
  height: number | null;
  altText: string | null;
};

/**
 * One photograph per post, most liked first.
 *
 * A post with several images contributes its first one only: six photographs
 * from six posts says more about the site than six angles of the same model.
 */
export function assembleImageHighlights(input: {
  posts: ImagePostRow[];
  media: ImageMediaRow[];
  limit: number;
  maxPerAuthor?: number;
}): HighlightImage[] {
  const firstByPost = new Map<string, ImageMediaRow>();
  for (const row of input.media) {
    const current = firstByPost.get(row.postId);
    if (!current || row.position < current.position) {
      firstByPost.set(row.postId, row);
    }
  }

  const ranked = [...input.posts].sort(
    (a, b) => b.likeCount - a.likeCount || b.postId.localeCompare(a.postId),
  );

  const images: HighlightImage[] = [];
  for (const row of ranked) {
    const image = firstByPost.get(row.postId);
    // A text post, or one whose media went with a moderation removal.
    if (!image) continue;
    images.push({
      postId: row.postId,
      mediaId: image.id,
      imageId: image.imageId,
      width: image.width,
      height: image.height,
      altText: image.altText,
      likeCount: row.likeCount,
      author: {
        userId: row.authorId,
        username: row.username,
        displayName: row.displayName,
      },
    });
  }

  return capPerAuthor(
    images,
    (image) => image.author.userId,
    input.maxPerAuthor ?? MAX_PER_AUTHOR,
  ).slice(0, input.limit);
}

/**
 * Keeps at most `max` items per person, preserving order.
 *
 * One painter having a very good month should not turn the strip into their
 * gallery — the section exists to show a visitor that several people are here.
 */
export function capPerAuthor<T>(
  items: T[],
  authorId: (item: T) => string,
  max: number,
): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const id = authorId(item);
    const count = seen.get(id) ?? 0;
    if (count >= max) continue;
    seen.set(id, count + 1);
    out.push(item);
  }
  return out;
}

/** Every person appearing in a set of highlights, deduplicated. */
export function authorIdsIn(highlights: Highlights): string[] {
  const ids = new Set<string>();
  for (const entry of highlights.projects) ids.add(entry.owner.userId);
  for (const entry of highlights.images) ids.add(entry.author.userId);
  return [...ids];
}

/** Drops everything by someone the viewer has blocked or muted. */
export function filterHidden(
  highlights: Highlights,
  hidden: Iterable<string>,
): Highlights {
  const set = hidden instanceof Set ? hidden : new Set(hidden);
  if (!set.size) return highlights;
  return {
    projects: highlights.projects.filter(
      (entry) => !set.has(entry.owner.userId),
    ),
    images: highlights.images.filter((entry) => !set.has(entry.author.userId)),
  };
}
