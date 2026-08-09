import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import {
  bookmark,
  follow,
  like,
  mute,
  post,
  postMedia,
  postProduct,
  profile,
  project,
  tag,
  postTag,
} from "../db/schema";
import { blockedUserIds, isBlockedEither } from "./moderation";

export type FeedTab = "following" | "discover" | "latest";

export type Cursor = { score: number; id: string } | null;

export function encodeCursor(cursor: Cursor): string | null {
  if (!cursor) return null;
  return `${cursor.score}~${cursor.id}`;
}

export function decodeCursor(raw: string | null | undefined): Cursor {
  if (!raw) return null;
  const at = raw.lastIndexOf("~");
  if (at < 1) return null;
  const score = Number(raw.slice(0, at));
  const id = raw.slice(at + 1);
  if (!Number.isFinite(score) || !id) return null;
  return { score, id };
}

export type FeedPost = {
  id: string;
  kind: "text" | "images";
  title: string | null;
  body: string | null;
  gameSystem: string | null;
  scale: string | null;
  wipStage: string | null;
  sensitive: boolean;
  likeCount: number;
  commentCount: number;
  publishedAt: number | null;
  createdAt: number;
  author: {
    userId: string;
    username: string;
    displayName: string;
    avatarImageId: string | null;
  };
  project: { id: string; title: string; slug: string } | null;
  media: {
    id: string;
    imageId: string;
    width: number | null;
    height: number | null;
    altText: string | null;
  }[];
  products: {
    id: string;
    kind: string;
    name: string;
    brand: string | null;
    shopUrl: string | null;
  }[];
  tags: string[];
  viewerHasLiked: boolean;
  viewerHasBookmarked: boolean;
};

export type FeedPage = { posts: FeedPost[]; nextCursor: string | null };

const PAGE_SIZE = 20;

/**
 * Ids the viewer must never see: anyone they blocked, anyone who blocked them,
 * anyone they muted. Kept as one small query because the list is short in
 * practice and D1 charges per statement, not per row.
 */
async function hiddenAuthorIds(db: Db, viewerId: string | null) {
  if (!viewerId) return [] as string[];

  const [blocked, muted] = await Promise.all([
    // Blocks are moderation's to define, so the union of both directions comes
    // from there rather than being spelled out a second time here.
    blockedUserIds(db, viewerId),
    db.select({ id: mute.mutedId }).from(mute).where(eq(mute.muterId, viewerId)),
  ]);

  return [...new Set([...blocked, ...muted.map((r) => r.id)])];
}

/**
 * Base predicate every feed shares: live, not deleted, from an account in good
 * standing, not from a hidden author.
 *
 * The account check is why suspension means anything. Suspending someone only
 * ever stopped them signing in; their work carried on sitting in Discover,
 * Latest and every tag and system feed, which is not what a moderator pressing
 * that button believes they are doing. Every feed query already joins `profile`
 * to render the byline, so the clause is free.
 *
 * `includeFollowersOnly` is true only for the Following tab, where the viewer
 * is by definition a follower of everyone in it. The public tabs stay strictly
 * public, so a followers-only post can never leak into Discover.
 */
function visiblePosts(hidden: string[], includeFollowersOnly = false) {
  const clauses = [
    eq(post.status, "published"),
    isNull(post.deletedAt),
    eq(profile.status, "active"),
    includeFollowersOnly
      ? inArray(post.visibility, ["public", "followers"])
      : eq(post.visibility, "public"),
  ];
  if (hidden.length) {
    clauses.push(notInArray(post.authorId, hidden));
  }
  return and(...clauses);
}

export async function getFeed(
  db: Db,
  options: {
    tab: FeedTab;
    viewerId: string | null;
    cursor?: string | null;
    limit?: number;
    gameSystem?: string | null;
    tagName?: string | null;
  },
): Promise<FeedPage> {
  const limit = Math.min(options.limit ?? PAGE_SIZE, 50);
  const cursor = decodeCursor(options.cursor);
  const hidden = await hiddenAuthorIds(db, options.viewerId);

  // "following" needs the graph; the other tabs are global.
  let followingIds: string[] | null = null;
  if (options.tab === "following") {
    if (!options.viewerId) return { posts: [], nextCursor: null };
    const rows = await db
      .select({ id: follow.followeeId })
      .from(follow)
      .where(eq(follow.followerId, options.viewerId));
    // Your own posts belong in your own feed — an empty following list should
    // still show you what you just posted.
    followingIds = [...rows.map((r) => r.id), options.viewerId];
  }

  const where = [visiblePosts(hidden, options.tab === "following")];

  if (followingIds) {
    if (!followingIds.length) return { posts: [], nextCursor: null };
    where.push(inArray(post.authorId, followingIds));
  }
  if (options.gameSystem) {
    where.push(eq(post.gameSystem, options.gameSystem));
  }
  if (options.tagName) {
    const tagRow = await db.query.tag.findFirst({
      where: eq(tag.name, options.tagName.toLowerCase()),
    });
    if (!tagRow) return { posts: [], nextCursor: null };
    /*
     * A subquery rather than a fetched list of ids. The list used to be read
     * separately and capped at 500 rows with no ORDER BY, which SQLite is free
     * to answer with a different 500 each time — so the keyset cursor skipped
     * or repeated posts between pages of any tag popular enough to matter, and
     * a tag with more than 500 posts could never page past the arbitrary cut.
     * Letting the database do the join keeps paging correct at any size.
     */
    where.push(
      inArray(
        post.id,
        db
          .select({ id: postTag.postId })
          .from(postTag)
          .where(eq(postTag.tagId, tagRow.id)),
      ),
    );
  }

  // Discover sorts by decayed engagement; the chronological tabs sort by time.
  // Both use keyset pagination on (sortKey, id) so a page boundary can never
  // duplicate or skip a row the way OFFSET does when new posts land mid-scroll.
  const byScore = options.tab === "discover";
  const sortColumn = byScore ? post.hotScore : post.publishedAt;

  if (cursor) {
    where.push(
      or(
        lt(sortColumn, cursor.score),
        and(eq(sortColumn, cursor.score), lt(post.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      post,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
      project: {
        id: project.id,
        title: project.title,
        slug: project.slug,
      },
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .leftJoin(project, eq(project.id, post.projectId))
    .where(and(...where))
    .orderBy(desc(sortColumn), desc(post.id))
    // One extra row tells us whether another page exists without a count query.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!page.length) return { posts: [], nextCursor: null };

  const posts = await hydrate(db, page, options.viewerId);

  const last = page[page.length - 1]!;
  const nextCursor = hasMore
    ? encodeCursor({
        score: byScore ? last.post.hotScore : (last.post.publishedAt ?? 0),
        id: last.post.id,
      })
    : null;

  return { posts, nextCursor };
}

type JoinedRow = {
  post: typeof post.$inferSelect;
  author: FeedPost["author"];
  project: { id: string | null; title: string | null; slug: string | null } | null;
};

/**
 * Fills in media, products, tags and the viewer's own like/bookmark state.
 *
 * Five queries for the whole page rather than five per post — D1 round trips
 * dominate feed latency, so batching by id is the difference between a fast
 * feed and a slow one.
 */
async function hydrate(
  db: Db,
  rows: JoinedRow[],
  viewerId: string | null,
): Promise<FeedPost[]> {
  const ids = rows.map((r) => r.post.id);

  const [media, products, tagRows, liked, bookmarked] = await Promise.all([
    db
      .select()
      .from(postMedia)
      .where(inArray(postMedia.postId, ids))
      .orderBy(postMedia.position),
    db
      .select()
      .from(postProduct)
      .where(inArray(postProduct.postId, ids))
      .orderBy(postProduct.position),
    db
      .select({ postId: postTag.postId, name: tag.name })
      .from(postTag)
      .innerJoin(tag, eq(tag.id, postTag.tagId))
      .where(inArray(postTag.postId, ids)),
    viewerId
      ? db
          .select({ subjectId: like.subjectId })
          .from(like)
          .where(
            and(
              eq(like.userId, viewerId),
              eq(like.subjectType, "post"),
              inArray(like.subjectId, ids),
            ),
          )
      : Promise.resolve([]),
    viewerId
      ? db
          .select({ postId: bookmark.postId })
          .from(bookmark)
          .where(
            and(eq(bookmark.userId, viewerId), inArray(bookmark.postId, ids)),
          )
      : Promise.resolve([]),
  ]);

  const mediaByPost = groupBy(media, (m) => m.postId);
  const productsByPost = groupBy(products, (p) => p.postId);
  const tagsByPost = groupBy(tagRows, (t) => t.postId);
  const likedSet = new Set(liked.map((l) => l.subjectId));
  const bookmarkedSet = new Set(bookmarked.map((b) => b.postId));

  return rows.map((row) => ({
    id: row.post.id,
    kind: row.post.kind,
    title: row.post.title,
    body: row.post.body,
    gameSystem: row.post.gameSystem,
    scale: row.post.scale,
    wipStage: row.post.wipStage,
    sensitive: row.post.sensitive,
    likeCount: row.post.likeCount,
    commentCount: row.post.commentCount,
    publishedAt: row.post.publishedAt,
    createdAt: row.post.createdAt,
    author: row.author,
    project:
      row.project && row.project.id
        ? {
            id: row.project.id,
            title: row.project.title!,
            slug: row.project.slug!,
          }
        : null,
    media: (mediaByPost.get(row.post.id) ?? []).map((m) => ({
      id: m.id,
      imageId: m.imageId,
      width: m.width,
      height: m.height,
      altText: m.altText,
    })),
    products: (productsByPost.get(row.post.id) ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      brand: p.brand,
      shopUrl: p.shopUrl,
    })),
    tags: (tagsByPost.get(row.post.id) ?? []).map((t) => t.name),
    viewerHasLiked: likedSet.has(row.post.id),
    viewerHasBookmarked: bookmarkedSet.has(row.post.id),
  }));
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** A single post with everything the detail page needs. */
export async function getPost(
  db: Db,
  postId: string,
  viewerId: string | null,
): Promise<FeedPost | null> {
  const rows = await db
    .select({
      post,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
      project: { id: project.id, title: project.title, slug: project.slug },
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .leftJoin(project, eq(project.id, post.projectId))
    .where(and(eq(post.id, postId), isNull(post.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Authors and moderators can see their own work before it is published or
  // after it is removed; nobody else can.
  const isOwner = viewerId != null && viewerId === row.post.authorId;
  if (row.post.status !== "published" && !isOwner) return null;
  if (row.post.visibility === "private" && !isOwner) return null;

  if (viewerId && !isOwner) {
    if (await isBlockedEither(db, viewerId, row.post.authorId)) return null;
  }

  if (row.post.visibility === "followers" && !isOwner) {
    if (!viewerId) return null;
    const rel = await db
      .select({ followerId: follow.followerId })
      .from(follow)
      .where(
        and(
          eq(follow.followerId, viewerId),
          eq(follow.followeeId, row.post.authorId),
        ),
      )
      .limit(1);
    if (!rel.length) return null;
  }

  const [hydrated] = await hydrate(db, [row as JoinedRow], viewerId);
  return hydrated ?? null;
}

/** Posts by one profile, newest first. Used on the profile page. */
export async function getProfilePosts(
  db: Db,
  authorId: string,
  viewerId: string | null,
  cursorRaw?: string | null,
  limit = PAGE_SIZE,
): Promise<FeedPage> {
  const cursor = decodeCursor(cursorRaw);
  const isOwner = viewerId === authorId;

  const where = [
    eq(post.authorId, authorId),
    isNull(post.deletedAt),
    ...(isOwner
      ? []
      : [
          eq(post.status, "published"),
          eq(post.visibility, "public"),
          // The profile page already renders a suspension notice instead of the
          // work, but it was still fetching the work to do it, and the API
          // handed it over outright. Suspension has to mean the same thing here
          // as it does in the feeds.
          eq(profile.status, "active"),
        ]),
  ];
  if (cursor) {
    /*
     * `coalesce(published_at, 0)` in both the predicate and the sort, the same
     * as getProjectEntries. A draft has no publish date, and `NULL < anything`
     * is NULL rather than true, so the plain comparison silently dropped every
     * draft from the owner's own second page — the one place drafts are meant
     * to show. The cursor already reads a missing date as 0; this makes the
     * query agree with it.
     */
    where.push(
      sql`(coalesce(${post.publishedAt}, 0) < ${cursor.score}
        or (coalesce(${post.publishedAt}, 0) = ${cursor.score} and ${post.id} < ${cursor.id}))`,
    );
  }

  const rows = await db
    .select({
      post,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
      project: { id: project.id, title: project.title, slug: project.slug },
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .leftJoin(project, eq(project.id, post.projectId))
    .where(and(...where))
    .orderBy(sql`coalesce(${post.publishedAt}, 0) desc, ${post.id} desc`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!page.length) return { posts: [], nextCursor: null };

  const posts = await hydrate(db, page as JoinedRow[], viewerId);
  const last = page[page.length - 1]!;

  return {
    posts,
    nextCursor: hasMore
      ? encodeCursor({ score: last.post.publishedAt ?? 0, id: last.post.id })
      : null,
  };
}

/**
 * The viewer's saved posts.
 *
 * A bookmark is a snapshot of a decision made in the past, so it has to be
 * re-checked against the present every time it is read. Someone can save a
 * public post and then be blocked by its author, or watch it be made private,
 * removed by a moderator or written by an account since suspended — and until
 * now /saved kept showing all of it, because the only thing it asked was
 * whether the row had been soft-deleted. The rules below are the ones every
 * other feed path applies.
 */
export async function getBookmarks(
  db: Db,
  viewerId: string,
  limit = PAGE_SIZE,
): Promise<FeedPost[]> {
  const [saved, hidden] = await Promise.all([
    db
      .select({ postId: bookmark.postId })
      .from(bookmark)
      .where(eq(bookmark.userId, viewerId))
      .orderBy(desc(bookmark.createdAt))
      .limit(limit),
    hiddenAuthorIds(db, viewerId),
  ]);
  if (!saved.length) return [];

  const rows = await db
    .select({
      post,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
      project: { id: project.id, title: project.title, slug: project.slug },
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .leftJoin(project, eq(project.id, post.projectId))
    .where(
      and(
        inArray(
          post.id,
          saved.map((s) => s.postId),
        ),
        isNull(post.deletedAt),
        eq(post.status, "published"),
        eq(profile.status, "active"),
        ...(hidden.length ? [notInArray(post.authorId, hidden)] : []),
        // Your own saved post stays yours to see. A followers-only one survives
        // only while you still follow the author, which is the same rule getPost
        // applies to the post's own page.
        or(
          eq(post.authorId, viewerId),
          eq(post.visibility, "public"),
          and(
            eq(post.visibility, "followers"),
            exists(
              db
                .select({ one: sql`1` })
                .from(follow)
                .where(
                  and(
                    eq(follow.followerId, viewerId),
                    eq(follow.followeeId, post.authorId),
                  ),
                ),
            ),
          ),
        )!,
      ),
    );

  const order = new Map(saved.map((s, i) => [s.postId, i]));
  const hydrated = await hydrate(db, rows as JoinedRow[], viewerId);
  return hydrated.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

/**
 * The posts in one build log, oldest first.
 *
 * Every other listing in this codebase is newest-first, because that is what a
 * feed is for. A build log is the opposite: it is a story, and the interesting
 * thing about it is the progression from bare plastic to finished model. Read
 * newest-first it is a stack of disconnected photos; read oldest-first it is
 * the reason someone follows the project at all.
 *
 * That flips the keyset comparison — `gt` rather than `lt`, ascending order —
 * so the cursor is not interchangeable with a feed cursor even though it has
 * the same shape.
 */
export async function getProjectPosts(
  db: Db,
  projectId: string,
  viewerId: string | null,
  ownerId: string,
  cursorRaw?: string | null,
  limit = PAGE_SIZE,
): Promise<FeedPage> {
  const cursor = decodeCursor(cursorRaw);
  const isOwner = viewerId === ownerId;

  const where = [
    eq(post.projectId, projectId),
    isNull(post.deletedAt),
    ...(isOwner
      ? []
      : [eq(post.status, "published"), eq(post.visibility, "public")]),
  ];
  if (cursor) {
    // Same `coalesce(published_at, 0)` as getProfilePosts and
    // getProjectEntries, for the same reason: a draft's null date must compare
    // as 0 or the owner's second page loses every draft.
    where.push(
      sql`(coalesce(${post.publishedAt}, 0) > ${cursor.score}
        or (coalesce(${post.publishedAt}, 0) = ${cursor.score} and ${post.id} > ${cursor.id}))`,
    );
  }

  const rows = await db
    .select({
      post,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
      project: { id: project.id, title: project.title, slug: project.slug },
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .leftJoin(project, eq(project.id, post.projectId))
    .where(and(...where))
    .orderBy(sql`coalesce(${post.publishedAt}, 0) asc, ${post.id} asc`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!page.length) return { posts: [], nextCursor: null };

  const posts = await hydrate(db, page as JoinedRow[], viewerId);
  const last = page[page.length - 1]!;

  return {
    posts,
    nextCursor: hasMore
      ? encodeCursor({ score: last.post.publishedAt ?? 0, id: last.post.id })
      : null,
  };
}
