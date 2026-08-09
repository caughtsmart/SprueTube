/*
 * Build logs — the parts of a project that go beyond "a list of posts".
 *
 * server/services/feed.ts already knows how to read a build log in date order.
 * This module owns the three things that make one a build log rather than a
 * filtered feed: a manual running order, a pinned "where it is now" entry, and
 * comments on the log itself and on individual photographs.
 */

import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import {
  bookmark,
  comment,
  like,
  post,
  postMedia,
  postProduct,
  postTag,
  profile,
  project,
  tag,
} from "../db/schema";
import type { FeedPost } from "./feed";
import { createNotification } from "./posts";
/*
 * The ordering rules themselves are in app/lib, not here, because the owner's
 * reorder controls run in the browser and must sort by exactly what the server
 * sorts by. Same arrangement as taxonomy.ts.
 */
import { planReorder } from "../../app/lib/build-log";

const PAGE_SIZE = 20;

/**
 * How many entries one reorder call may renumber.
 *
 * The owner UI sends the whole running order, so this is really a cap on how
 * long a build log can be before reordering has to happen a page at a time.
 * Two hundred entries is several years of weekly posts.
 */
export const MAX_REORDER_ENTRIES = 200;

/** Longest comment thread we will render in one go, matching the post page. */
const MAX_COMMENTS = 200;

/* -------------------------------------------------------------------------- */
/* Cursors                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A keyset cursor carrying all three sort keys.
 *
 * The feed cursor in feed.ts holds one score and an id, which is enough when
 * the order is a single column. This order has three keys and the first one is
 * nullable, so the cursor has to carry the lot — an empty first field means the
 * row it points at had no manual position.
 *
 * Never OFFSET: entries are added to a build log while people are reading it,
 * and an offset would quietly repeat or skip one at every page boundary.
 */
export type EntryCursor = {
  position: number | null;
  publishedAt: number;
  id: string;
};

export function encodeEntryCursor(cursor: EntryCursor | null): string | null {
  if (!cursor) return null;
  return `${cursor.position ?? ""}~${cursor.publishedAt}~${cursor.id}`;
}

export function decodeEntryCursor(
  raw: string | null | undefined,
): EntryCursor | null {
  if (!raw) return null;

  const first = raw.indexOf("~");
  const second = raw.indexOf("~", first + 1);
  if (first < 0 || second < 0) return null;

  const positionRaw = raw.slice(0, first);
  const publishedAt = Number(raw.slice(first + 1, second));
  // Ids never contain '~', so everything after the second separator is the id.
  const id = raw.slice(second + 1);
  if (!id || !Number.isFinite(publishedAt)) return null;

  if (positionRaw === "") return { position: null, publishedAt, id };

  const position = Number(positionRaw);
  if (!Number.isInteger(position)) return null;
  return { position, publishedAt, id };
}

/* -------------------------------------------------------------------------- */
/* Comment targets                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The write-time guard for the comment table's three shapes.
 *
 * schema.ts spells out the invariant and says why it is not a CHECK constraint.
 * This is where it is actually enforced, so every insert in this module goes
 * through it — a comment that names both a post and a build log, or neither, is
 * a bug that would otherwise be discovered months later by a counter that no
 * longer matches its rows.
 *
 * A photo comment carries its post's id as well as the media id. That is not
 * redundancy: it means moderation, the cascade on post deletion and the post's
 * own comment count all keep working without knowing photo comments exist.
 */
export type CommentTarget = {
  postId?: string | null;
  mediaId?: string | null;
  projectId?: string | null;
};

export type CommentTargetProblem =
  | "no_target"
  | "both_targets"
  | "media_without_post";

export function checkCommentTarget(
  target: CommentTarget,
): CommentTargetProblem | null {
  const hasPost = Boolean(target.postId);
  const hasProject = Boolean(target.projectId);

  if (hasPost && hasProject) return "both_targets";
  if (!hasPost && !hasProject) return "no_target";
  if (target.mediaId && !hasPost) return "media_without_post";

  return null;
}

/* -------------------------------------------------------------------------- */
/* Threading                                                                  */
/* -------------------------------------------------------------------------- */

export type Threadable = { id: string; parentId: string | null };

/**
 * Flat rows in, one level of nesting out.
 *
 * A reply whose parent has been removed is dropped rather than promoted to the
 * top of the thread, because a reply read without the thing it replies to is
 * usually worse than no reply at all. This matches the post page.
 */
export function threadComments<T extends Threadable>(
  rows: readonly T[],
): (T & { replies: T[] })[] {
  const roots: (T & { replies: T[] })[] = [];
  const byId = new Map<string, T & { replies: T[] }>();

  for (const row of rows) {
    if (row.parentId) continue;
    const node = { ...row, replies: [] as T[] };
    byId.set(row.id, node);
    roots.push(node);
  }

  for (const row of rows) {
    if (!row.parentId) continue;
    byId.get(row.parentId)?.replies.push(row);
  }

  return roots;
}

/** Photo comments keyed by the image they are about. */
export function groupCommentsByMedia<T extends { mediaId: string | null }>(
  rows: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.mediaId) continue;
    const list = out.get(row.mediaId);
    if (list) list.push(row);
    else out.set(row.mediaId, [row]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reading entries                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Exactly the visibility rule the build log page uses: the owner sees drafts,
 * private entries and everything else; nobody else sees anything but published
 * public entries. Blocks are handled one level up, where the whole page is
 * refused rather than quietly emptied.
 */
function visibleEntries(projectId: string, isOwner: boolean): SQL[] {
  const clauses: SQL[] = [
    eq(post.projectId, projectId),
    isNull(post.deletedAt),
  ];
  if (!isOwner) {
    clauses.push(eq(post.status, "published"), eq(post.visibility, "public"));
  }
  return clauses;
}

/**
 * One page of a build log in its running order.
 *
 * The ORDER BY below has to say exactly what `compareEntries` in
 * app/lib/build-log.ts says — that comment is where the rule is explained, and
 * the tests hold the two together. `(x is null)` evaluates to 0 or 1 in SQLite,
 * so sorting on it first is a portable spelling of NULLS LAST, and
 * `coalesce(published_at, 0)` keeps a draft's null date on the same footing
 * here as it has in the cursor.
 */
export async function getProjectEntries(
  db: Db,
  options: {
    projectId: string;
    ownerId: string;
    viewerId: string | null;
    cursor?: string | null;
    limit?: number;
  },
): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const limit = Math.min(options.limit ?? PAGE_SIZE, 50);
  const isOwner = options.viewerId === options.ownerId;
  const where = visibleEntries(options.projectId, isOwner);

  const cursor = decodeEntryCursor(options.cursor);
  if (cursor) {
    const after = sql`(coalesce(${post.publishedAt}, 0) > ${cursor.publishedAt}
      or (coalesce(${post.publishedAt}, 0) = ${cursor.publishedAt} and ${post.id} > ${cursor.id}))`;

    where.push(
      cursor.position === null
        ? // The cursor is already past every positioned entry, so only the
          // unpositioned tail is left.
          sql`(${post.projectPosition} is null and ${after})`
        : sql`(${post.projectPosition} is null
            or ${post.projectPosition} > ${cursor.position}
            or (${post.projectPosition} = ${cursor.position} and ${after}))`,
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
    })
    .from(post)
    .innerJoin(profile, eq(profile.userId, post.authorId))
    .where(and(...where))
    .orderBy(
      sql`(${post.projectPosition} is null) asc, ${post.projectPosition} asc,
          coalesce(${post.publishedAt}, 0) asc, ${post.id} asc`,
    )
    // One extra row answers "is there another page?" without a count query.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!page.length) return { posts: [], nextCursor: null };

  const owner = await db.query.project.findFirst({
    where: eq(project.id, options.projectId),
    columns: { id: true, title: true, slug: true },
  });

  const posts = await hydrateEntries(db, page, options.viewerId, owner ?? null);
  const last = page[page.length - 1]!;

  return {
    posts,
    nextCursor: hasMore
      ? encodeEntryCursor({
          position: last.post.projectPosition,
          publishedAt: last.post.publishedAt ?? 0,
          id: last.post.id,
        })
      : null,
  };
}

/**
 * Fills in media, products, tags and the viewer's own like and save state.
 *
 * This deliberately mirrors the private `hydrate` in feed.ts. Sharing it would
 * mean exporting an internal from a module this feature does not otherwise
 * touch; the shape it produces — `FeedPost` — is the shared contract, and that
 * is imported rather than copied. Five queries for the whole page, not five per
 * entry: D1 round trips are what a build log page costs.
 */
async function hydrateEntries(
  db: Db,
  rows: {
    post: typeof post.$inferSelect;
    author: FeedPost["author"];
  }[],
  viewerId: string | null,
  owningProject: { id: string; title: string; slug: string } | null,
): Promise<FeedPost[]> {
  const ids = rows.map((row) => row.post.id);

  const [media, products, tagRows, liked, saved] = await Promise.all([
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

  const mediaByPost = groupByKey(media, (row) => row.postId);
  const productsByPost = groupByKey(products, (row) => row.postId);
  const tagsByPost = groupByKey(tagRows, (row) => row.postId);
  const likedIds = new Set(liked.map((row) => row.subjectId));
  const savedIds = new Set(saved.map((row) => row.postId));

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
    project: owningProject,
    media: (mediaByPost.get(row.post.id) ?? []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      width: item.width,
      height: item.height,
      altText: item.altText,
    })),
    products: (productsByPost.get(row.post.id) ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      brand: item.brand,
      shopUrl: item.shopUrl,
    })),
    tags: (tagsByPost.get(row.post.id) ?? []).map((item) => item.name),
    viewerHasLiked: likedIds.has(row.post.id),
    viewerHasBookmarked: savedIds.has(row.post.id),
  }));
}

function groupByKey<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * The bare list the owner's reorder panel works on.
 *
 * Titles and dates only — the panel is a running order, not a second feed, and
 * loading full posts for it would double the cost of the page for a control
 * most visitors never see.
 */
export type EntryStub = {
  id: string;
  title: string | null;
  body: string | null;
  publishedAt: number | null;
  projectPosition: number | null;
  status: string;
};

export async function getEntryOrder(
  db: Db,
  projectId: string,
): Promise<EntryStub[]> {
  return db
    .select({
      id: post.id,
      title: post.title,
      body: post.body,
      publishedAt: post.publishedAt,
      projectPosition: post.projectPosition,
      status: post.status,
    })
    .from(post)
    .where(and(...visibleEntries(projectId, true)))
    .orderBy(
      sql`(${post.projectPosition} is null) asc, ${post.projectPosition} asc,
          coalesce(${post.publishedAt}, 0) asc, ${post.id} asc`,
    )
    .limit(MAX_REORDER_ENTRIES);
}

/* -------------------------------------------------------------------------- */
/* Writing the running order                                                  */
/* -------------------------------------------------------------------------- */

export async function setEntryOrder(
  db: Db,
  projectId: string,
  ownerId: string,
  requestedIds: readonly string[],
): Promise<{ updated: number } | null> {
  const owned = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.ownerId, ownerId)),
  });
  if (!owned) return null;

  const existing = await db
    .select({ id: post.id })
    .from(post)
    .where(and(eq(post.projectId, projectId), isNull(post.deletedAt)))
    .limit(MAX_REORDER_ENTRIES * 2);

  const plan = planReorder(
    requestedIds.slice(0, MAX_REORDER_ENTRIES),
    existing.map((row) => row.id),
  );
  if (!plan.length) return { updated: 0 };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const statements: any[] = plan.map((entry) =>
    db
      .update(post)
      .set({ projectPosition: entry.position })
      // The project id is in the predicate as well as the id, so a post that
      // left this build log between the page load and the save cannot be
      // renumbered by it.
      .where(and(eq(post.id, entry.id), eq(post.projectId, projectId))),
  );
  statements.push(
    db
      .update(project)
      .set({ updatedAt: nowSeconds })
      .where(eq(project.id, projectId)),
  );

  await db.batch(statements as [any, ...any[]]);
  return { updated: plan.length };
}

/* -------------------------------------------------------------------------- */
/* The pinned entry                                                           */
/* -------------------------------------------------------------------------- */

export type PinResult = "ok" | "not_owner" | "not_in_project";

/**
 * Pin or unpin the "where it is now" entry.
 *
 * Pass null to unpin. The post must still be in this build log and still exist:
 * pinning is the one place a project row points at a post without a foreign key
 * to enforce it, so every write has to check by hand.
 */
export async function setPinnedPost(
  db: Db,
  projectId: string,
  ownerId: string,
  postId: string | null,
): Promise<PinResult> {
  const owned = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.ownerId, ownerId)),
  });
  if (!owned) return "not_owner";

  if (postId) {
    const target = await db.query.post.findFirst({
      where: and(eq(post.id, postId), eq(post.projectId, projectId)),
    });
    if (!target || target.deletedAt) return "not_in_project";
  }

  await db
    .update(project)
    .set({ pinnedPostId: postId, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(project.id, projectId));

  return "ok";
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

export type CommentView = {
  id: string;
  body: string;
  parentId: string | null;
  mediaId: string | null;
  likeCount: number;
  createdAt: number;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarImageId: string | null;
};

const commentColumns = {
  id: comment.id,
  body: comment.body,
  parentId: comment.parentId,
  mediaId: comment.mediaId,
  likeCount: comment.likeCount,
  createdAt: comment.createdAt,
  authorUsername: profile.username,
  authorDisplayName: profile.displayName,
  authorAvatarImageId: profile.avatarImageId,
};

/**
 * The only writer of comment rows in this module.
 *
 * Everything funnels through here so the "exactly one of postId / projectId"
 * rule is checked once, and so the counter for whatever the comment hangs off
 * moves in the same batch as the row itself. D1 runs a batch as one
 * transaction, so a count can never be left describing a row that failed to
 * insert.
 */
async function insertComment(
  db: Db,
  input: {
    authorId: string;
    postId: string | null;
    mediaId: string | null;
    projectId: string | null;
    parentId: string | null;
    body: string;
  },
): Promise<string> {
  const problem = checkCommentTarget(input);
  if (problem) throw new Error(problem);

  const id = newId("c");
  const statements: any[] = [
    db.insert(comment).values({
      id,
      postId: input.postId,
      mediaId: input.mediaId,
      projectId: input.projectId,
      authorId: input.authorId,
      parentId: input.parentId,
      body: input.body.trim().slice(0, 2000),
    }),
  ];

  if (input.postId) {
    statements.push(
      db
        .update(post)
        .set({ commentCount: sql`${post.commentCount} + 1` })
        .where(eq(post.id, input.postId)),
    );
  }
  if (input.projectId) {
    statements.push(
      db
        .update(project)
        .set({ commentCount: sql`${project.commentCount} + 1` })
        .where(eq(project.id, input.projectId)),
    );
  }

  await db.batch(statements as [any, ...any[]]);
  return id;
}

/**
 * Resolves a reply to its root, or to null.
 *
 * One level of nesting only, exactly as on the post page: a reply to a reply
 * attaches to its grandparent. A parent from a different thread is ignored
 * rather than rejected, because the only way to send one is a stale page.
 */
async function resolveParent(
  db: Db,
  parentId: string | null | undefined,
  matches: (row: typeof comment.$inferSelect) => boolean,
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await db.query.comment.findFirst({
    where: eq(comment.id, parentId),
  });
  if (!parent || !matches(parent)) return null;
  return parent.parentId ?? parent.id;
}

/** A comment on the build log itself, rather than on any one entry. */
export async function addProjectComment(
  db: Db,
  authorId: string,
  projectId: string,
  body: string,
  parentId?: string | null,
): Promise<string> {
  const target = await db.query.project.findFirst({
    where: eq(project.id, projectId),
  });
  if (!target) throw new Error("project_not_found");

  const resolvedParent = await resolveParent(
    db,
    parentId,
    (row) => row.projectId === projectId,
  );

  const id = await insertComment(db, {
    authorId,
    postId: null,
    mediaId: null,
    projectId,
    parentId: resolvedParent,
    body,
  });

  await notifyComment(db, {
    ownerId: target.ownerId,
    authorId,
    resolvedParent,
    subjectType: "project",
    subjectId: projectId,
    body,
  });

  return id;
}

/** A comment about one photograph inside an entry. */
export async function addMediaComment(
  db: Db,
  authorId: string,
  postId: string,
  mediaId: string,
  body: string,
  parentId?: string | null,
): Promise<string> {
  const target = await db.query.post.findFirst({ where: eq(post.id, postId) });
  if (!target || target.deletedAt) throw new Error("post_not_found");

  const image = await db.query.postMedia.findFirst({
    where: and(eq(postMedia.id, mediaId), eq(postMedia.postId, postId)),
  });
  if (!image) throw new Error("media_not_found");

  const resolvedParent = await resolveParent(
    db,
    parentId,
    (row) => row.mediaId === mediaId,
  );

  const id = await insertComment(db, {
    authorId,
    postId,
    mediaId,
    projectId: null,
    parentId: resolvedParent,
    body,
  });

  await notifyComment(db, {
    ownerId: target.authorId,
    authorId,
    resolvedParent,
    subjectType: "post",
    subjectId: postId,
    body,
  });

  return id;
}

async function notifyComment(
  db: Db,
  input: {
    ownerId: string;
    authorId: string;
    resolvedParent: string | null;
    subjectType: "post" | "project";
    subjectId: string;
    body: string;
  },
) {
  const preview = input.body.trim().slice(0, 140);

  if (input.ownerId !== input.authorId) {
    await createNotification(db, {
      userId: input.ownerId,
      actorId: input.authorId,
      type: input.resolvedParent ? "reply" : "comment",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      preview,
    });
  }

  // The person being replied to wants to know too, unless they are the owner we
  // have already told.
  if (!input.resolvedParent) return;
  const parent = await db.query.comment.findFirst({
    where: eq(comment.id, input.resolvedParent),
  });
  if (
    parent &&
    parent.authorId !== input.authorId &&
    parent.authorId !== input.ownerId
  ) {
    await createNotification(db, {
      userId: parent.authorId,
      actorId: input.authorId,
      type: "reply",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      preview,
    });
  }
}

export async function getProjectComments(
  db: Db,
  projectId: string,
): Promise<CommentView[]> {
  return db
    .select(commentColumns)
    .from(comment)
    .innerJoin(profile, eq(profile.userId, comment.authorId))
    .where(
      and(
        eq(comment.projectId, projectId),
        eq(comment.status, "published"),
        isNull(comment.deletedAt),
      ),
    )
    .orderBy(asc(comment.createdAt))
    .limit(MAX_COMMENTS);
}

/**
 * Every photo comment on one entry, in one query.
 *
 * The caller groups them by image. Fetching per image would be one round trip
 * per photograph, and an entry can carry ten.
 */
export async function getMediaComments(
  db: Db,
  postId: string,
): Promise<CommentView[]> {
  return db
    .select(commentColumns)
    .from(comment)
    .innerJoin(profile, eq(profile.userId, comment.authorId))
    .where(
      and(
        eq(comment.postId, postId),
        sql`${comment.mediaId} is not null`,
        eq(comment.status, "published"),
        isNull(comment.deletedAt),
      ),
    )
    .orderBy(asc(comment.createdAt))
    .limit(MAX_COMMENTS);
}
