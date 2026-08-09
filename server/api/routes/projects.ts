import { Hono } from "hono";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import type { Db } from "../../db/client";
import { block, profile, project } from "../../db/schema";
import { getPost } from "../../services/feed";
import {
  addMediaComment,
  addProjectComment,
  getMediaComments,
  getProjectComments,
  getProjectEntries,
  groupCommentsByMedia,
  setEntryOrder,
  setPinnedPost,
  threadComments,
  MAX_REORDER_ENTRIES,
} from "../../services/projects";

/*
 * Build logs: running order, the pinned "current state" entry, and the two new
 * kinds of comment.
 *
 * The plain CRUD for a project lives in routes/content.ts alongside posts,
 * because creating a build log is part of posting. What is here is everything
 * that only makes sense once a build log has entries in it.
 *
 * Path shapes are not arbitrary. content.ts already owns `GET /projects/:a/:b`,
 * and this module is mounted after it, so any new three-segment GET under
 * /projects would be swallowed by that route and answered with "No such
 * painter". Reads therefore hang off the four-segment username/slug form the
 * page URLs already use, and owner-only writes address the project by id the
 * way the existing PATCH and DELETE do.
 */
export const projects = new Hono<ApiEnv>();

const bodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  parentId: z.string().max(60).nullish(),
});

const orderSchema = z.object({
  postIds: z.array(z.string().min(1).max(60)).max(MAX_REORDER_ENTRIES),
});

const pinSchema = z.object({ postId: z.string().min(1).max(60) });

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A build log by owner and slug, refused if either party has blocked the other.
 *
 * The block rule is the one the page loader applies: blocking someone hides
 * their build log exactly as it hides their profile, and it 404s rather than
 * 403s so the block itself is not announced.
 */
async function loadVisibleProject(
  db: Db,
  username: string,
  slug: string,
  viewerId: string | null,
) {
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!owner || owner.status === "deleted") {
    throw apiError(404, "not_found", "No such painter.");
  }

  if (viewerId && viewerId !== owner.userId) {
    const blocked = await db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${owner.userId})
            or (${block.blockerId} = ${owner.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) {
      throw apiError(404, "not_found", "No such build log.");
    }
  }

  const found = await db.query.project.findFirst({
    where: and(eq(project.ownerId, owner.userId), eq(project.slug, slug)),
  });
  if (!found) throw apiError(404, "not_found", "No such build log.");

  return { project: found, owner };
}

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One page of a build log in its running order.
 *
 * Separate from content.ts's `/posts` endpoint on the same build log, which
 * returns strict date order. Both are useful — the date order is the honest
 * history — so neither replaces the other, and the cursors are not
 * interchangeable because the sort keys differ.
 */
projects.get("/projects/:username/:slug/entries", async (c) => {
  const db = c.get("db");
  const viewerId = c.get("user")?.id ?? null;
  const found = await loadVisibleProject(
    db,
    c.req.param("username"),
    c.req.param("slug"),
    viewerId,
  );

  const page = await getProjectEntries(db, {
    projectId: found.project.id,
    ownerId: found.owner.userId,
    viewerId,
    cursor: c.req.query("cursor"),
    limit: Number(c.req.query("limit")) || undefined,
  });

  return c.json({ ...page, pinnedPostId: found.project.pinnedPostId });
});

/** Set the running order. Owner only; sends the whole order, not a diff. */
projects.patch("/projects/:id/order", requireAuth, async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("That is not a running order.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const result = await setEntryOrder(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    parsed.data.postIds,
  );
  if (!result) {
    throw apiError(404, "not_found", "That build log is not yours.");
  }

  return c.json({ ok: true, ...result });
});

/* -------------------------------------------------------------------------- */
/* The pinned entry                                                           */
/* -------------------------------------------------------------------------- */

projects.post("/projects/:id/pin", requireAuth, async (c) => {
  const parsed = pinSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Pick an entry to pin.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const result = await setPinnedPost(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    parsed.data.postId,
  );
  if (result === "not_owner") {
    throw apiError(404, "not_found", "That build log is not yours.");
  }
  if (result === "not_in_project") {
    throw badRequest("That entry is not in this build log.");
  }

  return c.json({ ok: true, pinnedPostId: parsed.data.postId });
});

projects.delete("/projects/:id/pin", requireAuth, async (c) => {
  const result = await setPinnedPost(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    null,
  );
  if (result !== "ok") {
    throw apiError(404, "not_found", "That build log is not yours.");
  }
  return c.json({ ok: true, pinnedPostId: null });
});

/* -------------------------------------------------------------------------- */
/* Comments on the build log                                                  */
/* -------------------------------------------------------------------------- */

projects.get("/projects/:username/:slug/comments", async (c) => {
  const db = c.get("db");
  const found = await loadVisibleProject(
    db,
    c.req.param("username"),
    c.req.param("slug"),
    c.get("user")?.id ?? null,
  );

  const rows = await getProjectComments(db, found.project.id);
  return c.json({ comments: threadComments(rows) });
});

projects.post("/projects/:id/comments", requireAuth, async (c) => {
  await rateLimit(c, "comment", { max: 40, windowSeconds: 600 });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Write something first.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  try {
    const id = await addProjectComment(
      c.get("db"),
      c.get("user")!.id,
      c.req.param("id"),
      parsed.data.body,
      parsed.data.parentId,
    );
    return c.json({ id }, 201);
  } catch (error) {
    throw commentError(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Comments on one photograph                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every photo comment on one entry, grouped by image.
 *
 * Visibility is delegated to getPost, which already knows the whole rule —
 * drafts, private entries, followers-only and blocks. A photo comment is no
 * more public than the photograph it is about.
 */
projects.get("/posts/:id/media-comments", async (c) => {
  const db = c.get("db");
  const postId = c.req.param("id");

  const found = await getPost(db, postId, c.get("user")?.id ?? null);
  if (!found) throw apiError(404, "not_found", "That post is not here.");

  const grouped = groupCommentsByMedia(await getMediaComments(db, postId));

  return c.json({
    media: found.media.map((image) => ({
      mediaId: image.id,
      comments: threadComments(grouped.get(image.id) ?? []),
    })),
  });
});

projects.post(
  "/posts/:postId/media/:mediaId/comments",
  requireAuth,
  async (c) => {
    await rateLimit(c, "comment", { max: 40, windowSeconds: 600 });

    const parsed = bodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw badRequest("Write something first.", {
        fields: fieldErrors(parsed.error.issues),
      });
    }

    const db = c.get("db");
    const postId = c.req.param("postId");

    // Same check as the read: you can only comment on a photograph you are
    // allowed to see.
    const visible = await getPost(db, postId, c.get("user")!.id);
    if (!visible) throw apiError(404, "not_found", "That post is not here.");

    try {
      const id = await addMediaComment(
        db,
        c.get("user")!.id,
        postId,
        c.req.param("mediaId"),
        parsed.data.body,
        parsed.data.parentId,
      );
      return c.json({ id }, 201);
    } catch (error) {
      throw commentError(error);
    }
  },
);

/**
 * Service errors that are really "you asked about something that is not there".
 *
 * The comment-target failures are last-resort: the routes above never build an
 * invalid target, so seeing one means a bug rather than a bad request, and it
 * should surface as a 500 rather than be dressed up as the client's fault.
 */
function commentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "project_not_found") {
    return apiError(404, "not_found", "That build log is not here.");
  }
  if (message === "post_not_found") {
    return apiError(404, "not_found", "That post is not here.");
  }
  if (message === "media_not_found") {
    return apiError(404, "not_found", "That photo is not in this post.");
  }
  return error;
}
