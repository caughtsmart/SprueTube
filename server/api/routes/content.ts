import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import type { Db } from "../../db/client";
import { newId } from "../../db/id";
import { comment, like, post, profile, project } from "../../db/schema";
import {
  getBookmarks,
  getFeed,
  getPost,
  type FeedTab,
} from "../../services/feed";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  setBookmark,
  setPostLike,
} from "../../services/posts";
import { commentSchema, createPostSchema, projectSchema } from "../validators";

export const content = new Hono<ApiEnv>();

/* -------------------------------------------------------------------------- */
/* Feeds                                                                      */
/* -------------------------------------------------------------------------- */

content.get("/feed", async (c) => {
  const requested = c.req.query("tab");
  const tab: FeedTab =
    requested === "following" || requested === "latest" ? requested : "discover";

  const page = await getFeed(c.get("db"), {
    tab,
    viewerId: c.get("user")?.id ?? null,
    cursor: c.req.query("cursor"),
    gameSystem: c.req.query("system") ?? null,
    tagName: c.req.query("tag") ?? null,
    limit: Number(c.req.query("limit")) || undefined,
  });

  return c.json(page);
});

content.get("/bookmarks", requireAuth, async (c) => {
  const posts = await getBookmarks(c.get("db"), c.get("user")!.id);
  return c.json({ posts, nextCursor: null });
});

/* -------------------------------------------------------------------------- */
/* Posts                                                                      */
/* -------------------------------------------------------------------------- */

content.post("/posts", requireAuth, async (c) => {
  // Enough headroom for a genuine burst of photos, tight enough that a runaway
  // script cannot fill the feed.
  await rateLimit(c, "create-post", { max: 20, windowSeconds: 600 });

  const me = c.get("profile")!;
  if (!me.birthdate) {
    throw apiError(
      403,
      "onboarding_required",
      "Finish setting up your profile before posting.",
    );
  }

  const parsed = createPostSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const db = c.get("db");
  const input = parsed.data;

  // A post can only join a project the poster owns.
  if (input.projectId) {
    const owned = await db.query.project.findFirst({
      where: and(
        eq(project.id, input.projectId),
        eq(project.ownerId, c.get("user")!.id),
      ),
    });
    if (!owned) throw badRequest("That project does not exist.");
  }

  const created = await createPost(db, c.get("user")!.id, {
    ...input,
    title: input.title ?? null,
    body: input.body ?? null,
    gameSystem: input.gameSystem ?? null,
    scale: input.scale ?? null,
    wipStage: input.wipStage ?? null,
    projectId: input.projectId ?? null,
  });

  return c.json(created, 201);
});

content.get("/posts/:id", async (c) => {
  const found = await getPost(
    c.get("db"),
    c.req.param("id"),
    c.get("user")?.id ?? null,
  );
  if (!found) throw apiError(404, "not_found", "That post is not here.");

  // Fire-and-forget: a view count is not worth delaying the response for, and
  // it must never fail the request.
  c.executionCtx?.waitUntil(
    c
      .get("db")
      .update(post)
      .set({ viewCount: sql`${post.viewCount} + 1` })
      .where(eq(post.id, found.id))
      .then(
        () => undefined,
        () => undefined,
      ),
  );

  return c.json({ post: found });
});

content.delete("/posts/:id", requireAuth, async (c) => {
  const ok = await deletePost(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw apiError(404, "not_found", "That post is not yours to delete.");
  return c.json({ ok: true });
});

content.post("/posts/:id/like", requireAuth, async (c) => {
  await rateLimit(c, "like", { max: 300, windowSeconds: 300 });
  return c.json(
    await setPostLike(c.get("db"), c.get("user")!.id, c.req.param("id"), true),
  );
});

content.delete("/posts/:id/like", requireAuth, async (c) =>
  c.json(
    await setPostLike(c.get("db"), c.get("user")!.id, c.req.param("id"), false),
  ),
);

content.post("/posts/:id/bookmark", requireAuth, async (c) =>
  c.json(
    await setBookmark(c.get("db"), c.get("user")!.id, c.req.param("id"), true),
  ),
);

content.delete("/posts/:id/bookmark", requireAuth, async (c) =>
  c.json(
    await setBookmark(c.get("db"), c.get("user")!.id, c.req.param("id"), false),
  ),
);

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

content.get("/posts/:id/comments", async (c) => {
  const db = c.get("db");
  const postId = c.req.param("id");
  const viewerId = c.get("user")?.id ?? null;

  const rows = await db
    .select({
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      likeCount: comment.likeCount,
      createdAt: comment.createdAt,
      author: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
    })
    .from(comment)
    .innerJoin(profile, eq(profile.userId, comment.authorId))
    .where(
      and(
        eq(comment.postId, postId),
        eq(comment.status, "published"),
        isNull(comment.deletedAt),
      ),
    )
    .orderBy(asc(comment.createdAt))
    .limit(200);

  const likedIds = viewerId && rows.length
    ? new Set(
        (
          await db
            .select({ subjectId: like.subjectId })
            .from(like)
            .where(
              and(
                eq(like.userId, viewerId),
                eq(like.subjectType, "comment"),
                inArray(
                  like.subjectId,
                  rows.map((r) => r.id),
                ),
              ),
            )
        ).map((r) => r.subjectId),
      )
    : new Set<string>();

  // Flat list in, one level of threads out. The client just renders it.
  const roots = rows.filter((r) => !r.parentId);
  const repliesByParent = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = repliesByParent.get(row.parentId);
    if (list) list.push(row);
    else repliesByParent.set(row.parentId, [row]);
  }

  return c.json({
    comments: roots.map((root) => ({
      ...root,
      viewerHasLiked: likedIds.has(root.id),
      replies: (repliesByParent.get(root.id) ?? []).map((reply) => ({
        ...reply,
        viewerHasLiked: likedIds.has(reply.id),
      })),
    })),
  });
});

content.post("/posts/:id/comments", requireAuth, async (c) => {
  await rateLimit(c, "comment", { max: 40, windowSeconds: 600 });

  const parsed = commentSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Write something first.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  try {
    const id = await addComment(
      c.get("db"),
      c.get("user")!.id,
      c.req.param("id"),
      parsed.data.body,
      parsed.data.parentId,
    );
    return c.json({ id }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "post_not_found") {
      throw apiError(404, "not_found", "That post is not here.");
    }
    throw error;
  }
});

content.delete("/comments/:id", requireAuth, async (c) => {
  const ok = await deleteComment(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw apiError(404, "not_found", "Nothing to delete.");
  return c.json({ ok: true });
});

content.post("/comments/:id/like", requireAuth, async (c) =>
  c.json(await toggleCommentLike(c.get("db"), c.get("user")!.id, c.req.param("id"), true)),
);
content.delete("/comments/:id/like", requireAuth, async (c) =>
  c.json(await toggleCommentLike(c.get("db"), c.get("user")!.id, c.req.param("id"), false)),
);

async function toggleCommentLike(
  db: Db,
  userId: string,
  commentId: string,
  liked: boolean,
) {
  const existing = await db.query.like.findFirst({
    where: and(
      eq(like.userId, userId),
      eq(like.subjectType, "comment"),
      eq(like.subjectId, commentId),
    ),
  });

  if (liked && !existing) {
    await db.batch([
      db
        .insert(like)
        .values({ userId, subjectType: "comment", subjectId: commentId }),
      db
        .update(comment)
        .set({ likeCount: sql`${comment.likeCount} + 1` })
        .where(eq(comment.id, commentId)),
    ]);
  } else if (!liked && existing) {
    await db.batch([
      db
        .delete(like)
        .where(
          and(
            eq(like.userId, userId),
            eq(like.subjectType, "comment"),
            eq(like.subjectId, commentId),
          ),
        ),
      db
        .update(comment)
        .set({ likeCount: sql`max(0, ${comment.likeCount} - 1)` })
        .where(eq(comment.id, commentId)),
    ]);
  }

  return { liked };
}

/* -------------------------------------------------------------------------- */
/* Projects (build logs)                                                      */
/* -------------------------------------------------------------------------- */

content.get("/projects", requireAuth, async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(project)
    .where(eq(project.ownerId, c.get("user")!.id))
    .orderBy(desc(project.updatedAt))
    .limit(100);
  return c.json({ projects: rows });
});

content.post("/projects", requireAuth, async (c) => {
  const parsed = projectSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const db = c.get("db");
  const ownerId = c.get("user")!.id;
  const id = newId("prj");
  const slug = await uniqueProjectSlug(db, ownerId, parsed.data.title);

  await db.insert(project).values({
    id,
    ownerId,
    slug,
    title: parsed.data.title,
    summary: parsed.data.summary ?? null,
    gameSystem: parsed.data.gameSystem ?? null,
    scale: parsed.data.scale ?? null,
    status: parsed.data.status,
    coverImageId: parsed.data.coverImageId ?? null,
  });

  return c.json({ id, slug }, 201);
});

content.get("/profiles/:username/projects", async (c) => {
  const db = c.get("db");
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username").toLowerCase()}`,
  });
  if (!owner) throw apiError(404, "not_found", "No such painter.");

  const rows = await db
    .select()
    .from(project)
    .where(eq(project.ownerId, owner.userId))
    .orderBy(desc(project.updatedAt))
    .limit(100);
  return c.json({ projects: rows });
});

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

async function uniqueProjectSlug(
  db: Db,
  ownerId: string,
  title: string,
) {
  const base = slugify(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.query.project.findFirst({
      where: and(eq(project.ownerId, ownerId), eq(project.slug, candidate)),
    });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
