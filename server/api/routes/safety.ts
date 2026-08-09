import { Hono } from "hono";
import { and, desc, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  requireModerator,
  type ApiEnv,
} from "../context";
import { notification, profile } from "../../db/schema";
import {
  applyModerationAction,
  blockedUserIds,
  getReportQueue,
  submitReport,
} from "../../services/moderation";
import { moderationSchema, reportSchema } from "../validators";

export const safety = new Hono<ApiEnv>();

/**
 * Anyone signed in can report anything. Rate limited, because a report queue
 * flooded by one angry user is a queue that helps nobody.
 */
safety.post("/reports", requireAuth, async (c) => {
  await rateLimit(c, "report", { max: 20, windowSeconds: 3600 });

  const parsed = reportSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Pick a reason.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const id = await submitReport(c.get("db"), {
    reporterId: c.get("user")!.id,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });

  return c.json({ id, ok: true }, 201);
});

/* -------------------------------------------------------------------------- */
/* Moderator-only                                                             */
/* -------------------------------------------------------------------------- */

safety.get("/moderation/reports", requireAuth, requireModerator, async (c) =>
  c.json({ reports: await getReportQueue(c.get("db")) }),
);

safety.post("/moderation/actions", requireAuth, requireModerator, async (c) => {
  const parsed = moderationSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Invalid moderation action.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const moderator = c.get("profile")!;
  const input = parsed.data;

  // A moderator cannot suspend another moderator or an admin; that is an
  // admin's call. Stops one compromised mod account taking out the team.
  if (input.action === "suspend_user" && moderator.role !== "admin") {
    const target = await c.get("db").query.profile.findFirst({
      where: eq(profile.userId, input.subjectId),
    });
    if (target && target.role !== "user") {
      throw apiError(403, "forbidden", "Only an admin can suspend a moderator.");
    }
  }

  await applyModerationAction(c.get("db"), {
    moderatorId: moderator.userId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reportId: input.reportId ?? null,
    reason: input.reason ?? null,
    notifyUser: input.notifyUser,
  });

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Filtered by block on the way out, not only on the way in.
 *
 * Fixing the write paths stops new notifications from a blocked person, but the
 * rows already in the table keep surfacing their name and avatar every time the
 * list is opened — and a block is supposed to be the end of hearing from
 * somebody, not the start of a slow tail. `actorId` is null on system messages,
 * which must stay.
 */
safety.get("/notifications", requireAuth, async (c) => {
  const db = c.get("db");
  const userId = c.get("user")!.id;
  const hidden = await blockedUserIds(db, userId);

  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      subjectType: notification.subjectType,
      subjectId: notification.subjectId,
      preview: notification.preview,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      actor: {
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
    })
    .from(notification)
    .leftJoin(profile, eq(profile.userId, notification.actorId))
    .where(
      and(
        eq(notification.userId, userId),
        ...(hidden.length
          ? [
              or(
                isNull(notification.actorId),
                notInArray(notification.actorId, hidden),
              )!,
            ]
          : []),
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(100);

  return c.json({ notifications: rows });
});

safety.post("/notifications/read", requireAuth, async (c) => {
  await c
    .get("db")
    .update(notification)
    .set({ readAt: Math.floor(Date.now() / 1000) })
    .where(
      and(
        eq(notification.userId, c.get("user")!.id),
        sql`${notification.readAt} is null`,
      ),
    );
  return c.json({ ok: true });
});
