import { and, eq, gte, sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { post, postMedia } from "../db/schema";
import { getVideo } from "./media";
import { publishVideoPost, markVideoFailed } from "./posts";
import { hotScore, REFRESH_WINDOW_SECONDS } from "./ranking";

/**
 * Recomputes Discover scores for recent posts.
 *
 * Done in JavaScript in bounded pages rather than as one SQL UPDATE: `power()`
 * is an optional SQLite build flag, and a feed that silently stops ranking
 * because of a build flag is a bad trade for a query we run every 15 minutes.
 */
export async function refreshHotScores(env: Env, limit = 500) {
  const db = createDb(env.DB);
  const since = Math.floor(Date.now() / 1000) - REFRESH_WINDOW_SECONDS;

  const rows = await db
    .select({
      id: post.id,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      viewCount: post.viewCount,
      publishedAt: post.publishedAt,
    })
    .from(post)
    .where(and(eq(post.status, "published"), gte(post.publishedAt, since)))
    .limit(limit);

  if (!rows.length) return { updated: 0 };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const statements = rows.map((row) =>
    db
      .update(post)
      .set({ hotScore: hotScore({ ...row, now: nowSeconds }) })
      .where(eq(post.id, row.id)),
  );

  // D1 caps how much one batch can do; chunk so a busy day cannot blow the
  // statement limit and lose the whole refresh.
  for (let i = 0; i < statements.length; i += 50) {
    const chunk = statements.slice(i, i + 50);
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
  }

  await reconcileStuckVideos(env);

  return { updated: rows.length };
}

/**
 * Catches videos whose Stream webhook never arrived.
 *
 * Webhooks get lost — a deploy mid-flight, a signature secret rotated at the
 * wrong moment. Without this, a post sits in `processing` forever and the
 * person who uploaded it thinks the site ate their video.
 */
async function reconcileStuckVideos(env: Env, maxChecks = 20) {
  const db = createDb(env.DB);
  const cutoff = Math.floor(Date.now() / 1000) - 5 * 60;

  const stuck = await db
    .select({ streamUid: postMedia.streamUid, postId: postMedia.postId })
    .from(postMedia)
    .innerJoin(post, eq(post.id, postMedia.postId))
    .where(
      and(
        eq(postMedia.status, "pending"),
        eq(postMedia.type, "video"),
        eq(post.status, "processing"),
        sql`${post.createdAt} < ${cutoff}`,
      ),
    )
    .limit(maxChecks);

  for (const row of stuck) {
    if (!row.streamUid) continue;
    try {
      const video = await getVideo(env, row.streamUid);
      if (video.readyToStream) {
        await publishVideoPost(db, row.streamUid, {
          durationSeconds: video.duration,
          width: video.input?.width,
          height: video.input?.height,
        });
      } else if (video.status?.state === "error") {
        await markVideoFailed(db, row.streamUid);
      }
    } catch (error) {
      console.error("failed to reconcile video", {
        streamUid: row.streamUid,
        error,
      });
    }
  }
}
