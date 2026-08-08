import { and, eq, gte } from "drizzle-orm";
import { createDb } from "../db/client";
import { post } from "../db/schema";
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

  return { updated: rows.length };
}
