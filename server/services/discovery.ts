/*
 * Top creators for the discovery hub.
 *
 * A leaderboard is a dangerous thing to add to a hobby community — chase the
 * wrong number and you get people optimising for it instead of painting. So the
 * score here is a *published formula in one file*, exactly like Discover's
 * (server/services/ranking.ts), and it is built to reward two things this hobby
 * actually values:
 *
 *   1. Engagement their recent work earned — likes, and comments weighted more
 *      heavily because a comment is a conversation and a like is a reflex. Same
 *      weights as the feed.
 *   2. Consistency, measured as the number of distinct *weeks* they posted in
 *      over the window — never days, and never a streak. Painting a model takes
 *      weeks; a mechanic that punishes a quiet fortnight is wrong for this
 *      hobby (docs/ROADMAP.md, "Things worth not doing"). Consistency is a
 *      gentle multiplier that lifts steady contributors, and its absence costs
 *      nothing a single great post cannot outweigh.
 *
 * Like the homepage highlights, the computed list is viewer-independent and
 * cached in KV; the viewer's blocks and mutes are applied to the short cached
 * list afterwards, so it is one read per load rather than a query per person.
 */

import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { block, mute, post, postMedia, profile } from "../db/schema";

/** The window the score looks back over. Long enough that a busy hobby month
 *  counts, short enough that the board reflects who is active now. */
export const CREATOR_WINDOW_SECONDS = 45 * 24 * 60 * 60;

/** Comments outweigh likes, the same 3:1 the feed uses. */
const COMMENT_WEIGHT = 3;
/** How much each active week lifts the score, and the ceiling on the bonus. */
const PER_WEEK_BONUS = 0.15;
const CONSISTENCY_CAP_WEEKS = 6;
/** Seconds in a week — the bucket size for "distinct weeks posted in". */
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export type TopCreator = {
  userId: string;
  username: string;
  displayName: string;
  avatarImageId: string | null;
  bio: string | null;
  followerCount: number;
  /** Public posts counted in the window. */
  postsCounted: number;
  /** Distinct weeks posted in, within the window. */
  weeksActive: number;
  /** likes + 3·comments across the counted posts. */
  engagement: number;
  score: number;
  /** A recent photograph of theirs, for the card. */
  sampleImageId: string | null;
};

export const TOP_CREATORS_CACHE_KEY = "discovery:creators:v1";
export const TOP_CREATORS_TTL_SECONDS = 15 * 60;

/** How many are shown, and how many are cached so the block filter is free. */
export const SHOWN_CREATORS = 8;
const CANDIDATE_CREATORS = 16;

/**
 * The score. Exported and pure so it can be reasoned about and tested, and so
 * the number on the page is never a mystery.
 */
export function creatorScore(input: {
  engagement: number;
  weeksActive: number;
}): number {
  const weeks = Math.min(Math.max(0, input.weeksActive), CONSISTENCY_CAP_WEEKS);
  return input.engagement * (1 + PER_WEEK_BONUS * weeks);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function getTopCreators(
  env: Env,
  db: Db,
  options: {
    viewerId?: string | null;
    /** Pass `ctx.waitUntil` so a cache miss does not wait on the KV write. */
    waitUntil?: (promise: Promise<unknown>) => void;
    now?: number;
  } = {},
): Promise<TopCreator[]> {
  try {
    const cached = await readCache(env);
    const all = cached ?? (await computeTopCreators(db, options.now));

    if (!cached) {
      const write = writeCache(env, all);
      if (options.waitUntil) options.waitUntil(write);
      else await write;
    }

    const hidden = await hiddenAmong(
      db,
      options.viewerId ?? null,
      all.map((c) => c.userId),
    );
    const visible = hidden.size
      ? all.filter((c) => !hidden.has(c.userId))
      : all;

    return visible.slice(0, SHOWN_CREATORS);
  } catch {
    // The hub without its creator strip is a much smaller problem than a hub
    // that will not render. Nothing here is load-bearing.
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

async function readCache(env: Env): Promise<TopCreator[] | null> {
  const cached = await env.CACHE.get(TOP_CREATORS_CACHE_KEY, "json");
  if (!Array.isArray(cached)) return null;
  return cached as TopCreator[];
}

function writeCache(env: Env, creators: TopCreator[]) {
  return env.CACHE.put(TOP_CREATORS_CACHE_KEY, JSON.stringify(creators), {
    expirationTtl: TOP_CREATORS_TTL_SECONDS,
  });
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

async function computeTopCreators(
  db: Db,
  now?: number,
): Promise<TopCreator[]> {
  const nowSeconds = now ?? Math.floor(Date.now() / 1000);
  const since = nowSeconds - CREATOR_WINDOW_SECONDS;

  const engagement = sql<number>`sum(${post.likeCount} + ${COMMENT_WEIGHT} * ${post.commentCount})`;
  const postsCounted = sql<number>`count(*)`;
  // Distinct 7-day buckets the author posted in — "weeks active", not days and
  // not a streak. Integer division on the unix second gives a stable bucket.
  const weeksActive = sql<number>`count(distinct (${post.publishedAt} / ${WEEK_SECONDS}))`;

  const rows = await db
    .select({
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarImageId: profile.avatarImageId,
      bio: profile.bio,
      followerCount: profile.followerCount,
      engagement,
      postsCounted,
      weeksActive,
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .where(
      and(
        eq(post.status, "published"),
        isNull(post.deletedAt),
        eq(post.visibility, "public"),
        eq(profile.status, "active"),
        gte(post.publishedAt, since),
      ),
    )
    .groupBy(profile.userId)
    // A rough ordering in SQL; the exact score and cut happen in assembly so
    // they are testable and identical whatever order rows arrive in.
    .orderBy(desc(engagement))
    .limit(CANDIDATE_CREATORS * 2);

  const ranked = assembleTopCreators(rows, CANDIDATE_CREATORS);
  if (!ranked.length) return [];

  // One representative recent photograph per creator, for the card.
  const samples = await db
    .select({
      authorId: post.authorId,
      imageId: postMedia.imageId,
      position: postMedia.position,
      createdAt: post.createdAt,
    })
    .from(post)
    .innerJoin(postMedia, eq(postMedia.postId, post.id))
    .where(
      and(
        inArray(
          post.authorId,
          ranked.map((c) => c.userId),
        ),
        eq(post.status, "published"),
        isNull(post.deletedAt),
        eq(post.visibility, "public"),
        eq(post.sensitive, false),
      ),
    )
    .orderBy(desc(post.createdAt))
    .limit(CANDIDATE_CREATORS * 4);

  const sampleByAuthor = bestSampleByAuthor(samples);
  return ranked.map((c) => ({
    ...c,
    sampleImageId: sampleByAuthor.get(c.userId) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Pure assembly                                                              */
/* -------------------------------------------------------------------------- */

export type CreatorAggregateRow = {
  userId: string;
  username: string;
  displayName: string;
  avatarImageId: string | null;
  bio: string | null;
  followerCount: number;
  engagement: number | null;
  postsCounted: number | null;
  weeksActive: number | null;
};

/**
 * Scores the aggregate rows and returns the top `limit`, most valuable first.
 *
 * A creator whose recent work earned nothing is dropped rather than shown with
 * a zero — the board is "who is worth a look", not a full roll call.
 */
export function assembleTopCreators(
  rows: CreatorAggregateRow[],
  limit: number,
): Omit<TopCreator, "sampleImageId">[] {
  const out: Omit<TopCreator, "sampleImageId">[] = [];
  for (const row of rows) {
    const engagement = Number(row.engagement ?? 0);
    if (engagement <= 0) continue;
    const weeksActive = Number(row.weeksActive ?? 0);
    out.push({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarImageId: row.avatarImageId,
      bio: row.bio,
      followerCount: row.followerCount,
      postsCounted: Number(row.postsCounted ?? 0),
      weeksActive,
      engagement,
      score: creatorScore({ engagement, weeksActive }),
    });
  }

  out.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return out.slice(0, limit);
}

export type CreatorSampleRow = {
  authorId: string;
  imageId: string;
  position: number;
  createdAt: number;
};

/** Newest photograph per author, first image of that post. */
export function bestSampleByAuthor(
  rows: CreatorSampleRow[],
): Map<string, string> {
  const best = new Map<string, CreatorSampleRow>();
  for (const row of rows) {
    const current = best.get(row.authorId);
    if (
      !current ||
      row.createdAt > current.createdAt ||
      (row.createdAt === current.createdAt && row.position < current.position)
    ) {
      best.set(row.authorId, row);
    }
  }
  return new Map([...best].map(([id, row]) => [id, row.imageId]));
}

/**
 * Which of `ids` the viewer must not see: anyone they blocked, anyone who
 * blocked them, anyone they muted. Bounded by the candidate list, exactly like
 * the homepage highlights.
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
