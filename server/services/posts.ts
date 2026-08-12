import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import {
  bookmark,
  comment,
  follow,
  like,
  notification,
  post,
  postMedia,
  postProduct,
  postTag,
  profile,
  project,
  tag,
} from "../db/schema";
import { hotScore } from "./ranking";
import { pushToUser, type PushDelivery } from "./push";

import {
  MAX_BODY_LENGTH,
  MAX_IMAGES_PER_POST,
  MAX_TAGS_PER_POST,
} from "../../app/lib/taxonomy";

export { MAX_BODY_LENGTH, MAX_IMAGES_PER_POST };

export type CreatePostInput = {
  kind: "text" | "images";
  title?: string | null;
  body?: string | null;
  gameSystem?: string | null;
  scale?: string | null;
  wipStage?: string | null;
  visibility?: "public" | "followers" | "private";
  sensitive?: boolean;
  projectId?: string | null;
  tags?: string[];
  images?: { imageId: string; width?: number; height?: number; altText?: string }[];
  products?: {
    kind?: "paint" | "kit" | "tool" | "other";
    name: string;
    brand?: string | null;
    shopUrl?: string | null;
  }[];
};

/**
 * Hashtags written inline in the body, so `#deathguard` in the text becomes a
 * real tag without a separate field. Lowercased, deduped, capped.
 */
export function extractHashtags(body: string | null | undefined): string[] {
  if (!body) return [];
  const found = body.matchAll(/(?:^|\s)#([a-zA-Z0-9_]{2,30})/g);
  const seen = new Set<string>();
  for (const match of found) {
    const name = match[1]!.toLowerCase();
    if (!seen.has(name)) seen.add(name);
    if (seen.size >= MAX_TAGS_PER_POST) break;
  }
  return [...seen];
}

/** Usernames mentioned with @, so they can be notified. */
export function extractMentions(body: string | null | undefined): string[] {
  if (!body) return [];
  const found = body.matchAll(/(?:^|\s)@([a-zA-Z0-9_]{3,20})/g);
  return [...new Set([...found].map((m) => m[1]!.toLowerCase()))].slice(0, 10);
}

async function upsertTags(db: Db, names: string[]): Promise<string[]> {
  if (!names.length) return [];

  const existing = await db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(inArray(tag.name, names));
  const byName = new Map(existing.map((t) => [t.name, t.id]));

  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    const rows = missing.map((name) => ({ id: newId("tag"), name }));
    // Two posts can race on the same new tag; the unique index decides and the
    // loser just reuses the winner's row.
    await db.insert(tag).values(rows).onConflictDoNothing();
    const reread = await db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(inArray(tag.name, missing));
    for (const row of reread) byName.set(row.name, row.id);
  }

  return names.map((n) => byName.get(n)).filter((id): id is string => !!id);
}

export async function createPost(
  db: Db,
  authorId: string,
  input: CreatePostInput,
  delivery?: PushDelivery,
): Promise<{ id: string; status: "published" }> {
  const id = newId("p");
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Photos are uploaded to Cloudflare Images before the post is created, so
  // there is nothing to wait for — every post goes live immediately.
  const status = "published" as const;
  const publishedAt = nowSeconds;

  const body = input.body?.trim() || null;
  const tagNames = [
    ...new Set([
      ...(input.tags ?? []).map((t) => t.toLowerCase().replace(/^#/, "")),
      ...extractHashtags(body),
    ]),
  ]
    .filter((t) => /^[a-z0-9_]{2,30}$/.test(t))
    .slice(0, MAX_TAGS_PER_POST);

  const tagIds = await upsertTags(db, tagNames);

  const statements: any[] = [
    db.insert(post).values({
      id,
      authorId,
      projectId: input.projectId ?? null,
      kind: input.kind,
      title: input.title?.trim() || null,
      body,
      gameSystem: input.gameSystem ?? null,
      scale: input.scale ?? null,
      wipStage: (input.wipStage as never) ?? null,
      visibility: input.visibility ?? "public",
      sensitive: input.sensitive ?? false,
      status,
      publishedAt,
      hotScore: hotScore({
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        publishedAt: publishedAt ?? nowSeconds,
        now: nowSeconds,
      }),
    }),
  ];

  if (input.kind === "images") {
    const images = (input.images ?? []).slice(0, MAX_IMAGES_PER_POST);
    if (images.length) {
      statements.push(
        db.insert(postMedia).values(
          images.map((image, index) => ({
            id: newId("m"),
            postId: id,
            position: index,
            imageId: image.imageId,
            width: image.width ?? null,
            height: image.height ?? null,
            altText: image.altText?.slice(0, 400) ?? null,
          })),
        ),
      );
    }
  }

  if (input.products?.length) {
    statements.push(
      db.insert(postProduct).values(
        input.products.slice(0, 20).map((product, index) => ({
          id: newId("pp"),
          postId: id,
          position: index,
          kind: product.kind ?? ("paint" as const),
          name: product.name.slice(0, 120),
          brand: product.brand?.slice(0, 60) ?? null,
          shopUrl: product.shopUrl ?? null,
        })),
      ),
    );
  }

  if (tagIds.length) {
    statements.push(
      db
        .insert(postTag)
        .values(tagIds.map((tagId) => ({ postId: id, tagId })))
        .onConflictDoNothing(),
    );
    statements.push(
      db
        .update(tag)
        .set({ postCount: sql`${tag.postCount} + 1` })
        .where(inArray(tag.id, tagIds)),
    );
  }

  statements.push(
    db
      .update(profile)
      .set({ postCount: sql`${profile.postCount} + 1`, updatedAt: nowSeconds })
      .where(eq(profile.userId, authorId)),
  );

  if (input.projectId) {
    statements.push(
      db
        .update(project)
        .set({
          postCount: sql`${project.postCount} + 1`,
          updatedAt: nowSeconds,
        })
        .where(
          and(eq(project.id, input.projectId), eq(project.ownerId, authorId)),
        ),
    );
  }

  // D1 runs a batch as a single transaction, so the post and its counters
  // either all land or none do.
  await db.batch(statements as [any, ...any[]]);

  await notifyMentions(db, { authorId, postId: id, body }, delivery);

  return { id, status };
}

/** Soft delete — keeps the row so moderation history stays meaningful. */
export async function deletePost(db: Db, postId: string, authorId: string) {
  const row = await db.query.post.findFirst({ where: eq(post.id, postId) });
  if (!row || row.authorId !== authorId || row.deletedAt) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  // `any[]` to match createPost above: drizzle's batch tuple type does not
  // survive a heterogeneous array built with push.
  const statements: any[] = [
    db
      .update(post)
      .set({ deletedAt: nowSeconds, status: "removed" })
      .where(eq(post.id, postId)),
    db
      .update(profile)
      .set({ postCount: sql`max(0, ${profile.postCount} - 1)` })
      .where(eq(profile.userId, authorId)),
  ];

  // Creating a post increments the project's count, so deleting one has to
  // give it back. Without this a build log slowly claims more entries than it
  // shows, and the number is the first thing anyone reads on the card.
  if (row.projectId) {
    statements.push(
      db
        .update(project)
        .set({ postCount: sql`max(0, ${project.postCount} - 1)` })
        .where(eq(project.id, row.projectId)),
    );

    // project.pinnedPostId has no foreign key — schema.ts explains why — so
    // nothing else will clear it. Left behind, the build log would keep trying
    // to show a deleted entry as its current state. Same batch as the delete,
    // so the pin cannot survive a partial failure.
    statements.push(
      db
        .update(project)
        .set({ pinnedPostId: null })
        .where(
          and(eq(project.id, row.projectId), eq(project.pinnedPostId, postId)),
        ),
    );
  }

  await db.batch(statements as [any, ...any[]]);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Engagement                                                                 */
/* -------------------------------------------------------------------------- */

async function refreshHotScore(db: Db, postId: string) {
  const row = await db.query.post.findFirst({ where: eq(post.id, postId) });
  if (!row) return;
  await db
    .update(post)
    .set({
      hotScore: hotScore({
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        viewCount: row.viewCount,
        publishedAt: row.publishedAt,
      }),
    })
    .where(eq(post.id, postId));
}

export async function setPostLike(
  db: Db,
  userId: string,
  postId: string,
  liked: boolean,
  delivery?: PushDelivery,
): Promise<{ liked: boolean; likeCount: number }> {
  const target = await db.query.post.findFirst({ where: eq(post.id, postId) });
  if (!target) throw new Error("post_not_found");

  const existing = await db.query.like.findFirst({
    where: and(
      eq(like.userId, userId),
      eq(like.subjectType, "post"),
      eq(like.subjectId, postId),
    ),
  });

  // Liking twice is a no-op, not a double count — the client retries on flaky
  // mobile connections and must not be able to inflate the number.
  if (liked && existing) return { liked: true, likeCount: target.likeCount };
  if (!liked && !existing) return { liked: false, likeCount: target.likeCount };

  if (liked) {
    await db.batch([
      db.insert(like).values({ userId, subjectType: "post", subjectId: postId }),
      db
        .update(post)
        .set({ likeCount: sql`${post.likeCount} + 1` })
        .where(eq(post.id, postId)),
    ]);
    if (target.authorId !== userId) {
      await createNotification(
        db,
        {
          userId: target.authorId,
          actorId: userId,
          type: "like",
          subjectType: "post",
          subjectId: postId,
        },
        delivery,
      );
    }
  } else {
    await db.batch([
      db
        .delete(like)
        .where(
          and(
            eq(like.userId, userId),
            eq(like.subjectType, "post"),
            eq(like.subjectId, postId),
          ),
        ),
      db
        .update(post)
        .set({ likeCount: sql`max(0, ${post.likeCount} - 1)` })
        .where(eq(post.id, postId)),
    ]);
  }

  await refreshHotScore(db, postId);
  return {
    liked,
    likeCount: Math.max(0, target.likeCount + (liked ? 1 : -1)),
  };
}

export async function setBookmark(
  db: Db,
  userId: string,
  postId: string,
  saved: boolean,
) {
  if (saved) {
    await db.insert(bookmark).values({ userId, postId }).onConflictDoNothing();
  } else {
    await db
      .delete(bookmark)
      .where(and(eq(bookmark.userId, userId), eq(bookmark.postId, postId)));
  }
  return { saved };
}

export async function addComment(
  db: Db,
  authorId: string,
  postId: string,
  body: string,
  parentId?: string | null,
  delivery?: PushDelivery,
) {
  const target = await db.query.post.findFirst({ where: eq(post.id, postId) });
  if (!target || target.deletedAt) throw new Error("post_not_found");

  // Only one level of nesting: a reply to a reply attaches to its grandparent,
  // which keeps threads readable on a phone.
  let resolvedParent: string | null = null;
  if (parentId) {
    const parent = await db.query.comment.findFirst({
      where: eq(comment.id, parentId),
    });
    if (parent && parent.postId === postId) {
      resolvedParent = parent.parentId ?? parent.id;
    }
  }

  const id = newId("c");
  await db.batch([
    db.insert(comment).values({
      id,
      postId,
      authorId,
      parentId: resolvedParent,
      body: body.trim().slice(0, 2000),
    }),
    db
      .update(post)
      .set({ commentCount: sql`${post.commentCount} + 1` })
      .where(eq(post.id, postId)),
  ]);

  if (target.authorId !== authorId) {
    await createNotification(
      db,
      {
        userId: target.authorId,
        actorId: authorId,
        type: resolvedParent ? "reply" : "comment",
        subjectType: "post",
        subjectId: postId,
        preview: body.trim().slice(0, 140),
      },
      delivery,
    );
  }

  // The person being replied to also wants to know, unless they are the author
  // we just notified.
  if (resolvedParent) {
    const parent = await db.query.comment.findFirst({
      where: eq(comment.id, resolvedParent),
    });
    if (parent && parent.authorId !== authorId && parent.authorId !== target.authorId) {
      await createNotification(
        db,
        {
          userId: parent.authorId,
          actorId: authorId,
          type: "reply",
          subjectType: "post",
          subjectId: postId,
          preview: body.trim().slice(0, 140),
        },
        delivery,
      );
    }
  }

  await notifyMentions(db, { authorId, postId, body }, delivery);
  await refreshHotScore(db, postId);

  return id;
}

export async function deleteComment(db: Db, commentId: string, userId: string) {
  const row = await db.query.comment.findFirst({
    where: eq(comment.id, commentId),
  });
  if (!row || row.deletedAt) return false;

  /*
   * A comment now hangs off a post, an image inside a post, or a build log.
   * Whoever owns the thing it is attached to can remove it, same as before —
   * the only change is that "the thing" has three possible shapes.
   */
  const target = row.postId
    ? await db.query.post.findFirst({ where: eq(post.id, row.postId) })
    : null;
  const owningProject = row.projectId
    ? await db.query.project.findFirst({ where: eq(project.id, row.projectId) })
    : null;

  const allowed =
    row.authorId === userId ||
    target?.authorId === userId ||
    owningProject?.ownerId === userId;
  if (!allowed) return false;

  const statements: any[] = [
    db
      .update(comment)
      .set({ status: "removed", deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(comment.id, commentId)),
  ];

  if (row.postId) {
    statements.push(
      db
        .update(post)
        .set({ commentCount: sql`max(0, ${post.commentCount} - 1)` })
        .where(eq(post.id, row.postId)),
    );
  }
  if (row.projectId) {
    statements.push(
      db
        .update(project)
        .set({ commentCount: sql`max(0, ${project.commentCount} - 1)` })
        .where(eq(project.id, row.projectId)),
    );
  }

  await db.batch(statements as [any, ...any[]]);
  return true;
}

export async function setFollow(
  db: Db,
  followerId: string,
  followeeId: string,
  following: boolean,
  delivery?: PushDelivery,
) {
  if (followerId === followeeId) return { following: false };

  const existing = await db.query.follow.findFirst({
    where: and(
      eq(follow.followerId, followerId),
      eq(follow.followeeId, followeeId),
    ),
  });

  if (following && !existing) {
    await db.batch([
      db.insert(follow).values({ followerId, followeeId }),
      db
        .update(profile)
        .set({ followerCount: sql`${profile.followerCount} + 1` })
        .where(eq(profile.userId, followeeId)),
      db
        .update(profile)
        .set({ followingCount: sql`${profile.followingCount} + 1` })
        .where(eq(profile.userId, followerId)),
    ]);
    await createNotification(
      db,
      {
        userId: followeeId,
        actorId: followerId,
        type: "follow",
        subjectType: "user",
        subjectId: followerId,
      },
      delivery,
    );
  } else if (!following && existing) {
    await db.batch([
      db
        .delete(follow)
        .where(
          and(
            eq(follow.followerId, followerId),
            eq(follow.followeeId, followeeId),
          ),
        ),
      db
        .update(profile)
        .set({ followerCount: sql`max(0, ${profile.followerCount} - 1)` })
        .where(eq(profile.userId, followeeId)),
      db
        .update(profile)
        .set({ followingCount: sql`max(0, ${profile.followingCount} - 1)` })
        .where(eq(profile.userId, followerId)),
    ]);
  }

  return { following };
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export async function createNotification(
  db: Db,
  input: {
    userId: string;
    actorId?: string | null;
    type:
      | "like"
      | "comment"
      | "reply"
      | "follow"
      | "mention"
      | "system"
      | "message"
      | "listing_reply";
    subjectType?:
      | "post"
      | "comment"
      | "user"
      | "project"
      | "listing"
      | "message"
      | null;
    subjectId?: string | null;
    preview?: string | null;
  },
  /*
   * When present, the same notification is also delivered by Web Push, out of
   * band on `waitUntil` so it never sits on the request's critical path. Absent
   * ⇒ in-app only — every existing caller keeps working by passing nothing.
   */
  delivery?: PushDelivery,
) {
  await db.insert(notification).values({
    id: newId("n"),
    userId: input.userId,
    actorId: input.actorId ?? null,
    type: input.type,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    preview: input.preview ?? null,
  });

  if (delivery) {
    delivery.waitUntil(
      pushToUser(delivery.env, input).catch((error) =>
        console.error("push: fan-out failed", error),
      ),
    );
  }
}

async function notifyMentions(
  db: Db,
  input: { authorId: string; postId: string; body: string | null | undefined },
  delivery?: PushDelivery,
) {
  const usernames = extractMentions(input.body);
  if (!usernames.length) return;

  const mentioned = await db
    .select({ userId: profile.userId, username: profile.username })
    .from(profile)
    .where(
      sql`lower(${profile.username}) IN (${sql.join(
        usernames.map((u) => sql`${u}`),
        sql`, `,
      )})`,
    );

  for (const row of mentioned) {
    if (row.userId === input.authorId) continue;
    await createNotification(
      db,
      {
        userId: row.userId,
        actorId: input.authorId,
        type: "mention",
        subjectType: "post",
        subjectId: input.postId,
        preview: input.body?.slice(0, 140) ?? null,
      },
      delivery,
    );
  }
}
