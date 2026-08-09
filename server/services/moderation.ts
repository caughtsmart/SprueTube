/*
 * Trust and safety.
 *
 * This is not optional scaffolding. SprueTube is a UK user-to-user service, so
 * the Online Safety Act applies: there must be a way to report content, illegal
 * material must be dealt with quickly, and there has to be a record of what was
 * decided. App Store guideline 1.2 asks for the same shape — a report path, a
 * block path, and moderation that visibly happens.
 *
 * The design goal is that a one-person moderation team can keep up: reports are
 * prioritised rather than queued in arrival order, and every action writes one
 * audit row.
 */

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import {
  block,
  comment,
  follow,
  moderationAction,
  mute,
  post,
  profile,
  project,
  report,
} from "../db/schema";
import { createNotification } from "./posts";

import type { ReportReason } from "../../app/lib/taxonomy";

export type { ReportReason };
export { REPORT_REASON_LABELS } from "../../app/lib/taxonomy";

/**
 * Higher runs first in the queue. Anything that could be illegal or involves a
 * child is looked at before someone's complaint about a repost.
 */
const PRIORITY: Record<ReportReason, number> = {
  child_safety: 100,
  illegal: 90,
  violence: 80,
  self_harm: 80,
  hate: 60,
  harassment: 50,
  sexual: 50,
  impersonation: 30,
  intellectual_property: 30,
  spam: 10,
  other: 20,
};

export async function submitReport(
  db: Db,
  input: {
    reporterId: string | null;
    subjectType: ReportSubject;
    subjectId: string;
    reason: ReportReason;
    details?: string | null;
  },
) {
  // One open report per person per thing. Repeat submissions from the same
  // reporter should not make a queue look busier than it is.
  if (input.reporterId) {
    const existing = await db.query.report.findFirst({
      where: and(
        eq(report.reporterId, input.reporterId),
        eq(report.subjectType, input.subjectType),
        eq(report.subjectId, input.subjectId),
        eq(report.status, "open"),
      ),
    });
    if (existing) return existing.id;
  }

  const id = newId("r");
  await db.insert(report).values({
    id,
    reporterId: input.reporterId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reason: input.reason,
    details: input.details?.slice(0, 2000) ?? null,
    priority: PRIORITY[input.reason] ?? 20,
  });
  return id;
}

/*
 * Everything reportable. Listings, messages and build logs joined posts,
 * comments and people, and the queue resolves a readable preview for the three
 * that had one — the rest show as the bare subject until someone writes the
 * resolver, which is honest rather than a crash.
 */
export type ReportSubject =
  | "post"
  | "comment"
  | "user"
  | "project"
  | "listing"
  | "message";

export type QueuedReport = {
  id: string;
  subjectType: ReportSubject;
  subjectId: string;
  reason: string;
  details: string | null;
  priority: number;
  createdAt: number;
  reporter: { username: string } | null;
  /** The reported thing, resolved so the queue reads without extra clicks. */
  subject:
    | { type: "post"; id: string; body: string | null; authorUsername: string; status: string }
    | {
        type: "comment";
        id: string;
        body: string;
        postId: string | null;
        authorUsername: string;
      }
    | { type: "user"; id: string; username: string; displayName: string; status: string }
    | null;
};

export async function getReportQueue(db: Db, limit = 50): Promise<QueuedReport[]> {
  const reports = await db
    .select()
    .from(report)
    .where(eq(report.status, "open"))
    .orderBy(desc(report.priority), report.createdAt)
    .limit(limit);

  return Promise.all(
    reports.map(async (row) => {
      const reporter = row.reporterId
        ? ((await db.query.profile.findFirst({
            where: eq(profile.userId, row.reporterId),
            columns: { username: true },
          })) ?? null)
        : null;

      return {
        id: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        reason: row.reason,
        details: row.details,
        priority: row.priority,
        createdAt: row.createdAt,
        reporter,
        subject: await resolveSubject(db, row.subjectType, row.subjectId),
      };
    }),
  );
}

async function resolveSubject(
  db: Db,
  type: ReportSubject,
  id: string,
): Promise<QueuedReport["subject"]> {
  // Build logs, listings and messages have no preview resolver yet. Returning
  // null shows the report with its bare subject id rather than crashing the
  // whole queue on one row a moderator most needs to see.
  if (type !== "post" && type !== "comment" && type !== "user") return null;

  if (type === "post") {
    const row = await db.query.post.findFirst({ where: eq(post.id, id) });
    if (!row) return null;
    const author = await db.query.profile.findFirst({
      where: eq(profile.userId, row.authorId),
      columns: { username: true },
    });
    return {
      type: "post",
      id: row.id,
      body: row.body,
      authorUsername: author?.username ?? "unknown",
      status: row.status,
    };
  }

  if (type === "comment") {
    const row = await db.query.comment.findFirst({ where: eq(comment.id, id) });
    if (!row) return null;
    const author = await db.query.profile.findFirst({
      where: eq(profile.userId, row.authorId),
      columns: { username: true },
    });
    return {
      type: "comment",
      id: row.id,
      body: row.body,
      postId: row.postId,
      authorUsername: author?.username ?? "unknown",
    };
  }

  const row = await db.query.profile.findFirst({ where: eq(profile.userId, id) });
  if (!row) return null;
  return {
    type: "user",
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    status: row.status,
  };
}

export type ModerationVerdict =
  | "remove_post"
  | "restore_post"
  | "remove_comment"
  | "restore_comment"
  | "suspend_user"
  | "unsuspend_user"
  | "dismiss_report"
  | "mark_sensitive";

/**
 * Applies a decision and records it. The audit row is written whether or not
 * the subject still exists — "we looked at this and did nothing" is exactly the
 * kind of thing you need to be able to prove later.
 */
export async function applyModerationAction(
  db: Db,
  input: {
    moderatorId: string;
    action: ModerationVerdict;
    subjectType: ReportSubject;
    subjectId: string;
    reportId?: string | null;
    reason?: string | null;
    notifyUser?: boolean;
  },
) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  switch (input.action) {
    case "remove_post":
      await db
        .update(post)
        .set({ status: "removed", updatedAt: nowSeconds })
        .where(eq(post.id, input.subjectId));
      break;
    case "restore_post":
      await db
        .update(post)
        .set({ status: "published", updatedAt: nowSeconds })
        .where(eq(post.id, input.subjectId));
      break;
    case "mark_sensitive":
      await db
        .update(post)
        .set({ sensitive: true, updatedAt: nowSeconds })
        .where(eq(post.id, input.subjectId));
      break;
    case "remove_comment":
      await setCommentRemoved(db, input.subjectId, true, nowSeconds);
      break;
    case "restore_comment":
      await setCommentRemoved(db, input.subjectId, false, nowSeconds);
      break;
    case "suspend_user":
      await db
        .update(profile)
        .set({
          status: "suspended",
          statusReason: input.reason ?? "Breach of the community rules.",
          updatedAt: nowSeconds,
        })
        .where(eq(profile.userId, input.subjectId));
      break;
    case "unsuspend_user":
      await db
        .update(profile)
        .set({ status: "active", statusReason: null, updatedAt: nowSeconds })
        .where(eq(profile.userId, input.subjectId));
      break;
    case "dismiss_report":
      break;
  }

  await db.insert(moderationAction).values({
    id: newId("ma"),
    moderatorId: input.moderatorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reportId: input.reportId ?? null,
    reason: input.reason ?? null,
  });

  if (input.reportId) {
    await db
      .update(report)
      .set({
        status: input.action === "dismiss_report" ? "dismissed" : "actioned",
        handledBy: input.moderatorId,
        handledAt: nowSeconds,
      })
      .where(eq(report.id, input.reportId));
  }

  // Close any other open reports about the same thing — they have been answered.
  if (input.action !== "dismiss_report") {
    await db
      .update(report)
      .set({
        status: "actioned",
        handledBy: input.moderatorId,
        handledAt: nowSeconds,
      })
      .where(
        and(
          eq(report.subjectType, input.subjectType),
          eq(report.subjectId, input.subjectId),
          eq(report.status, "open"),
        ),
      );
  }

  if (input.notifyUser) {
    const affectedUserId = await subjectOwner(
      db,
      input.subjectType,
      input.subjectId,
    );
    if (affectedUserId) {
      await createNotification(db, {
        userId: affectedUserId,
        type: "system",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        preview:
          input.reason ??
          "A moderator has taken action on your content. See the community rules.",
      });
    }
  }
}

/**
 * Remove or restore a comment, moving the counter with it.
 *
 * `deleteComment` in posts.ts has always given the count back when someone
 * deletes their own comment. A moderator removal used to touch the row only, so
 * every moderated comment left the post permanently claiming a reply it no
 * longer shows — and the count is the first thing anyone reads under a post.
 *
 * The current state is checked first so a second removal, or a restore of
 * something that was never removed, cannot move the counter twice. Same batch
 * as the row itself, so a count can never describe a write that failed.
 */
async function setCommentRemoved(
  db: Db,
  commentId: string,
  removed: boolean,
  nowSeconds: number,
) {
  const row = await db.query.comment.findFirst({
    where: eq(comment.id, commentId),
  });
  if (!row) return;
  if (removed === Boolean(row.deletedAt)) return;

  const delta = removed ? sql`- 1` : sql`+ 1`;
  const statements: any[] = [
    db
      .update(comment)
      .set(
        removed
          ? { status: "removed", deletedAt: nowSeconds }
          : { status: "published", deletedAt: null },
      )
      .where(eq(comment.id, commentId)),
  ];

  if (row.postId) {
    statements.push(
      db
        .update(post)
        .set({ commentCount: sql`max(0, ${post.commentCount} ${delta})` })
        .where(eq(post.id, row.postId)),
    );
  }
  if (row.projectId) {
    statements.push(
      db
        .update(project)
        .set({ commentCount: sql`max(0, ${project.commentCount} ${delta})` })
        .where(eq(project.id, row.projectId)),
    );
  }

  await db.batch(statements as [any, ...any[]]);
}

async function subjectOwner(
  db: Db,
  type: ReportSubject,
  id: string,
): Promise<string | null> {
  if (type === "user") return id;
  // Owners of the newer subject kinds are not resolved yet, so the actor gets
  // no notification rather than the wrong person getting one.
  if (type !== "post" && type !== "comment") return null;
  if (type === "post") {
    const row = await db.query.post.findFirst({ where: eq(post.id, id) });
    return row?.authorId ?? null;
  }
  const row = await db.query.comment.findFirst({ where: eq(comment.id, id) });
  return row?.authorId ?? null;
}

/* -------------------------------------------------------------------------- */
/* The block guard                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Why the write paths ask this and not only the read paths.
 *
 * A block is mutual invisibility, and invisibility that covers reading alone is
 * not a block at all: the blocked person can still comment on the blocker's
 * work and still follow them, and every one of those writes posts the blocker a
 * notification carrying the name they asked never to see again. Follow, unfollow,
 * follow is then an unbounded channel to someone who wanted none. So the
 * question is asked once, here, and both sides use the answer.
 */
export type InteractionProblem = "blocked" | "unavailable";

/**
 * The decision itself, taken from facts already loaded and kept pure so it can
 * be tested without a database.
 *
 * Your own things are always yours to act on. A suspended or deleted account is
 * refused before the block is considered, because "unavailable" is the honest
 * answer there and it is the one the follow endpoint already gives.
 */
export function interactionProblem(facts: {
  viewerId: string;
  subjectId: string;
  subjectStatus: string;
  blocked: boolean;
}): InteractionProblem | null {
  if (facts.viewerId === facts.subjectId) return null;
  if (facts.subjectStatus !== "active") return "unavailable";
  return facts.blocked ? "blocked" : null;
}

/** True when either person has blocked the other, whichever way round it is. */
export async function isBlockedEither(
  db: Db,
  a: string,
  b: string,
): Promise<boolean> {
  if (a === b) return false;

  const rows = await db
    .select({ blockerId: block.blockerId })
    .from(block)
    .where(
      or(
        and(eq(block.blockerId, a), eq(block.blockedId, b)),
        and(eq(block.blockerId, b), eq(block.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Everyone the viewer has blocked, plus everyone who has blocked them.
 *
 * One list rather than two predicates, because every caller wants the union and
 * the list is short in practice. D1 charges per statement, not per row.
 */
export async function blockedUserIds(
  db: Db,
  viewerId: string | null,
): Promise<string[]> {
  if (!viewerId) return [];

  const [blockedByMe, blockedMe] = await Promise.all([
    db
      .select({ id: block.blockedId })
      .from(block)
      .where(eq(block.blockerId, viewerId)),
    db
      .select({ id: block.blockerId })
      .from(block)
      .where(eq(block.blockedId, viewerId)),
  ]);

  return [...new Set([...blockedByMe, ...blockedMe].map((row) => row.id))];
}

/**
 * The guard every write path shares: may this viewer act on that person's
 * things at all?
 *
 * Callers answer a refusal with the same 404 a missing row gets, so the
 * response cannot be used to detect a block the other person chose not to
 * announce.
 */
export async function checkInteraction(
  db: Db,
  viewerId: string,
  subjectId: string,
): Promise<InteractionProblem | null> {
  if (viewerId === subjectId) return null;

  const [subject, blocked] = await Promise.all([
    db.query.profile.findFirst({
      where: eq(profile.userId, subjectId),
      columns: { status: true },
    }),
    isBlockedEither(db, viewerId, subjectId),
  ]);
  if (!subject) return "unavailable";

  return interactionProblem({
    viewerId,
    subjectId,
    subjectStatus: subject.status,
    blocked,
  });
}

/* -------------------------------------------------------------------------- */
/* User-level controls                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Blocking is mutual invisibility and it also severs the follow edges — a
 * block that leaves someone still following you is not a block.
 */
export async function setBlock(
  db: Db,
  blockerId: string,
  blockedId: string,
  blocked: boolean,
) {
  if (blockerId === blockedId) return { blocked: false };

  if (blocked) {
    await db.insert(block).values({ blockerId, blockedId }).onConflictDoNothing();
    await unfollowBothWays(db, blockerId, blockedId);
  } else {
    await db
      .delete(block)
      .where(
        and(eq(block.blockerId, blockerId), eq(block.blockedId, blockedId)),
      );
  }
  return { blocked };
}

async function unfollowBothWays(db: Db, a: string, b: string) {
  const pairs = [
    { followerId: a, followeeId: b },
    { followerId: b, followeeId: a },
  ];

  for (const pair of pairs) {
    const existing = await db.query.follow.findFirst({
      where: and(
        eq(follow.followerId, pair.followerId),
        eq(follow.followeeId, pair.followeeId),
      ),
    });
    if (!existing) continue;

    await db.batch([
      db
        .delete(follow)
        .where(
          and(
            eq(follow.followerId, pair.followerId),
            eq(follow.followeeId, pair.followeeId),
          ),
        ),
      db
        .update(profile)
        .set({ followerCount: sql`max(0, ${profile.followerCount} - 1)` })
        .where(eq(profile.userId, pair.followeeId)),
      db
        .update(profile)
        .set({ followingCount: sql`max(0, ${profile.followingCount} - 1)` })
        .where(eq(profile.userId, pair.followerId)),
    ]);
  }
}

export async function setMute(
  db: Db,
  muterId: string,
  mutedId: string,
  muted: boolean,
) {
  if (muterId === mutedId) return { muted: false };

  if (muted) {
    await db.insert(mute).values({ muterId, mutedId }).onConflictDoNothing();
  } else {
    await db
      .delete(mute)
      .where(and(eq(mute.muterId, muterId), eq(mute.mutedId, mutedId)));
  }
  return { muted };
}

export { MINIMUM_AGE } from "../../app/lib/taxonomy";

export function ageFromBirthdate(birthdate: string, now = new Date()): number | null {
  const parsed = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - parsed.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }
  return age;
}
