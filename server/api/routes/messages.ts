import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  pushDelivery,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import { profile } from "../../db/schema";
import { REPORT_REASONS, type ReportReason } from "../../../app/lib/taxonomy";
import { submitReport } from "../../services/moderation";
import {
  deleteMessage,
  getThread,
  listInbox,
  listMessages,
  markThreadRead,
  messageForParticipant,
  MessagingError,
  openConversation,
  sendMessage,
  validateMessageBody,
} from "../../services/messaging";

/*
 * Direct messages.
 *
 * Every handler here resolves the thread from the session before it does
 * anything else. There is no path through this file where a conversation id in
 * a URL is treated as proof of anything — see getThread, which folds "not your
 * thread" and "one of you has blocked the other" into the same null.
 */
export const messages = new Hono<ApiEnv>();

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

messages.get("/conversations", requireAuth, async (c) =>
  c.json(
    await listInbox(c.get("db"), c.get("user")!.id, c.req.query("cursor")),
  ),
);

/**
 * Open a thread with someone, by handle.
 *
 * Idempotent: asking twice gives the same thread, because the pair is a unique
 * key. Rate limited, because "start a conversation with a stranger" is the one
 * action here that scales into harassment.
 */
messages.post("/conversations", requireAuth, async (c) => {
  await rateLimit(c, "open-conversation", { max: 20, windowSeconds: 3600 });

  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown };
  if (typeof body.username !== "string" || !body.username.trim()) {
    throw badRequest("Who do you want to message?");
  }

  const target = await c.get("db").query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${body.username.trim().toLowerCase()}`,
  });
  if (!target) throw apiError(404, "not_found", "No such painter.");

  try {
    const id = await openConversation(
      c.get("db"),
      c.get("user")!.id,
      target.userId,
    );
    return c.json({ conversationId: id }, 201);
  } catch (error) {
    throw translate(error);
  }
});

/* -------------------------------------------------------------------------- */
/* One thread                                                                 */
/* -------------------------------------------------------------------------- */

messages.get("/conversations/:id", requireAuth, async (c) => {
  const thread = await getThread(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!thread) throw notThere();

  return c.json({
    conversation: {
      id: thread.conversation.id,
      lastMessageAt: thread.conversation.lastMessageAt,
    },
    other: thread.other,
    unread: thread.unread,
  });
});

messages.get("/conversations/:id/messages", requireAuth, async (c) => {
  const page = await listMessages(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    c.req.query("cursor"),
  );
  if (!page) throw notThere();
  return c.json(page);
});

messages.post("/conversations/:id/messages", requireAuth, async (c) => {
  // Generous enough for a real back-and-forth about a paint scheme, tight
  // enough that nobody can bury someone under a wall of text in a minute.
  await rateLimit(c, "send-message", { max: 60, windowSeconds: 600 });

  const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
  const validated = validateMessageBody(body.body);
  if (!validated.ok) {
    throw badRequest(validated.message, { fields: { body: validated.message } });
  }

  try {
    const sent = await sendMessage(
      c.get("db"),
      {
        conversationId: c.req.param("id"),
        senderId: c.get("user")!.id,
        body: validated.body,
      },
      pushDelivery(c),
    );
    return c.json(sent, 201);
  } catch (error) {
    throw translate(error);
  }
});

messages.post("/conversations/:id/read", requireAuth, async (c) => {
  const ok = await markThreadRead(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw notThere();
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* One message                                                                */
/* -------------------------------------------------------------------------- */

messages.delete("/messages/:id", requireAuth, async (c) => {
  const ok = await deleteMessage(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw apiError(404, "not_found", "Nothing to withdraw.");
  return c.json({ ok: true });
});

/**
 * Report a message.
 *
 * Its own endpoint rather than the shared /reports one because reporting a
 * message needs a check the general endpoint cannot make: that the person
 * reporting is actually in the thread. Without it, an id guessed or leaked from
 * anywhere would let a stranger confirm that a private message exists.
 */
messages.post("/messages/:id/report", requireAuth, async (c) => {
  await rateLimit(c, "report", { max: 20, windowSeconds: 3600 });

  const body = (await c.req.json().catch(() => ({}))) as {
    reason?: unknown;
    details?: unknown;
  };
  if (!isReportReason(body.reason)) throw badRequest("Pick a reason.");

  const viewerId = c.get("user")!.id;
  const found = await messageForParticipant(
    c.get("db"),
    c.req.param("id"),
    viewerId,
  );
  if (!found) throw apiError(404, "not_found", "No such message.");

  // Reporting your own message would only ever be a mistake or a test.
  if (found.message.senderId === viewerId) {
    throw badRequest("That one is yours.");
  }

  const id = await submitReport(c.get("db"), {
    reporterId: viewerId,
    subjectType: "message",
    subjectId: found.message.id,
    reason: body.reason,
    details: typeof body.details === "string" ? body.details.trim() : null,
  });

  return c.json({ id, ok: true }, 201);
});

/* -------------------------------------------------------------------------- */

function isReportReason(value: unknown): value is ReportReason {
  return (
    typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value)
  );
}

/** One 404 for "no such thread", "not yours" and "blocked". */
function notThere() {
  return apiError(404, "not_found", "That conversation is not here.");
}

function translate(error: unknown) {
  if (!(error instanceof MessagingError)) return error;

  switch (error.message) {
    case "blocked":
      // Deliberately vague. Confirming a block back to the blocked person is
      // itself a small piece of information they can act on.
      return apiError(403, "unavailable", "You cannot message this person.");
    case "same_user":
      return badRequest("You cannot message yourself.");
    case "no_such_person":
      return apiError(404, "not_found", "No such painter.");
    case "not_a_participant":
    case "no_such_thread":
      return notThere();
    case "invalid_body":
      return badRequest("Write something first.");
    default:
      // Not one of ours. Hand it back untouched so a genuine fault still
      // reaches the 500 handler in ../index.ts rather than being dressed up
      // as a client mistake.
      return error;
  }
}
