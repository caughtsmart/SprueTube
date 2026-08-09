/*
 * Private messages.
 *
 * Messaging was deferred once already, and the reason was safety rather than
 * effort: a direct line between two strangers is the part of a social product
 * that harms people fastest. So the rules below are not decoration.
 *
 *   - A block in either direction stops sending and hides the thread.
 *   - Participation is decided by the conversation row against the session, on
 *     every read and every write. An id in a URL proves nothing.
 *   - Deletes are soft. A message that has been reported has to survive its
 *     sender's regret, or the report is unactionable the moment they tap it.
 *
 * The pair itself is the other thing worth being careful about — see orderPair.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import { block, conversation, message, profile } from "../db/schema";
import { createNotification } from "./posts";
import { encodeCursor, decodeCursor } from "./feed";
import { MAX_MESSAGE_LENGTH } from "../../app/lib/taxonomy";

export { MAX_MESSAGE_LENGTH };

/* -------------------------------------------------------------------------- */
/* The pair                                                                   */
/* -------------------------------------------------------------------------- */

export type Pair = { lowUserId: string; highUserId: string };

/**
 * The two participants in the fixed order the conversation table stores them.
 *
 * This is the single most load-bearing function in the feature. `lowUserId` and
 * `highUserId` exist so that a pair has one canonical form and can therefore
 * carry a unique index; the moment two callers disagree about which id goes in
 * which column, the same two people get two conversation rows, each holding
 * half of what they said to each other, and no amount of later care puts that
 * back together.
 *
 * Plain `<` on purpose. `localeCompare` is locale-dependent and would sort the
 * same pair differently on two machines, which is the exact failure this is
 * here to prevent.
 */
export function orderPair(a: string, b: string): Pair {
  if (!a || !b) throw new Error("missing_user_id");
  if (a === b) throw new Error("same_user");
  return a < b ? { lowUserId: a, highUserId: b } : { lowUserId: b, highUserId: a };
}

/** Which side of a thread someone is on, or null if they are not in it. */
export function sideOf(
  row: { lowUserId: string; highUserId: string },
  userId: string | null | undefined,
): "low" | "high" | null {
  if (!userId) return null;
  if (row.lowUserId === userId) return "low";
  if (row.highUserId === userId) return "high";
  return null;
}

/** The other person, or null if the viewer is not in the thread at all. */
export function otherUserId(
  row: { lowUserId: string; highUserId: string },
  userId: string,
): string | null {
  const side = sideOf(row, userId);
  if (!side) return null;
  return side === "low" ? row.highUserId : row.lowUserId;
}

export type ReadState = {
  lowUserId: string;
  highUserId: string;
  lastMessageAt: number;
  lastSenderId: string | null;
  lowReadAt: number | null;
  highReadAt: number | null;
};

/**
 * Whether a thread has something in it this person has not seen.
 *
 * Your own message is never unread to you, which matters because the send path
 * writes the sender's cursor in the same batch — this is the belt to that
 * braces, for threads written before the cursor existed.
 */
export function isUnreadFor(row: ReadState, userId: string): boolean {
  const side = sideOf(row, userId);
  if (!side) return false;
  if (row.lastSenderId === userId) return false;

  const readAt = side === "low" ? row.lowReadAt : row.highReadAt;
  return readAt === null || readAt < row.lastMessageAt;
}

/* -------------------------------------------------------------------------- */
/* Message text                                                               */
/* -------------------------------------------------------------------------- */

/** The one line the inbox shows. Newlines collapsed, because it is one line. */
export function messagePreview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export type ValidatedBody =
  | { ok: true; body: string }
  | { ok: false; message: string };

export function validateMessageBody(raw: unknown): ValidatedBody {
  if (typeof raw !== "string") return { ok: false, message: "Write something first." };

  const body = raw.trim();
  if (!body) return { ok: false, message: "Write something first." };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      message: `That is longer than ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, body };
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

/** True if either person has blocked the other. Direction does not matter. */
export async function isBlockedBetween(db: Db, a: string, b: string) {
  const rows = await db
    .select({ blockerId: block.blockerId })
    .from(block)
    .where(
      sql`(${block.blockerId} = ${a} and ${block.blockedId} = ${b})
          or (${block.blockerId} = ${b} and ${block.blockedId} = ${a})`,
    )
    .limit(1);
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Threads                                                                    */
/* -------------------------------------------------------------------------- */

export class MessagingError extends Error {}

export type ThreadView = {
  conversation: typeof conversation.$inferSelect;
  other: {
    userId: string;
    username: string;
    displayName: string;
    avatarImageId: string | null;
  };
  unread: boolean;
};

/**
 * Find or create the thread between two people.
 *
 * The insert can lose a race with the other participant opening the same thread
 * at the same moment; the unique index on the pair decides, and the loser reads
 * the winner's row rather than ending up with a duplicate.
 */
export async function openConversation(
  db: Db,
  viewerId: string,
  otherId: string,
): Promise<string> {
  if (viewerId === otherId) throw new MessagingError("same_user");

  const target = await db.query.profile.findFirst({
    where: eq(profile.userId, otherId),
  });
  if (!target || target.status !== "active") {
    throw new MessagingError("no_such_person");
  }
  if (await isBlockedBetween(db, viewerId, otherId)) {
    throw new MessagingError("blocked");
  }

  const pair = orderPair(viewerId, otherId);

  const existing = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.lowUserId, pair.lowUserId),
      eq(conversation.highUserId, pair.highUserId),
    ),
  });
  if (existing) return existing.id;

  const id = newId("cv");
  await db
    .insert(conversation)
    .values({ id, ...pair, lastMessageAt: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();

  const settled = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.lowUserId, pair.lowUserId),
      eq(conversation.highUserId, pair.highUserId),
    ),
  });
  if (!settled) throw new MessagingError("could_not_open");
  return settled.id;
}

/**
 * One thread, as the viewer. Null covers all three "you cannot have this":
 * no such thread, not your thread, and blocked either way.
 *
 * Every read and write below starts here rather than trusting the id it was
 * handed.
 */
export async function getThread(
  db: Db,
  conversationId: string,
  viewerId: string,
): Promise<ThreadView | null> {
  const row = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });
  if (!row) return null;

  const otherId = otherUserId(row, viewerId);
  if (!otherId) return null;

  if (await isBlockedBetween(db, viewerId, otherId)) return null;

  const other = await db.query.profile.findFirst({
    where: eq(profile.userId, otherId),
  });
  if (!other) return null;

  return {
    conversation: row,
    other: {
      userId: other.userId,
      username: other.username,
      displayName: other.displayName,
      avatarImageId: other.avatarImageId,
    },
    unread: isUnreadFor(row, viewerId),
  };
}

export type InboxEntry = {
  id: string;
  lastMessageAt: number;
  lastMessagePreview: string | null;
  lastSenderId: string | null;
  unread: boolean;
  other: {
    userId: string;
    username: string;
    displayName: string;
    avatarImageId: string | null;
  };
};

const INBOX_PAGE = 25;
const THREAD_PAGE = 40;

export async function listInbox(
  db: Db,
  viewerId: string,
  rawCursor?: string | null,
  limit = INBOX_PAGE,
): Promise<{ conversations: InboxEntry[]; nextCursor: string | null }> {
  const cursor = decodeCursor(rawCursor);
  const size = Math.min(Math.max(limit, 1), 50);

  // The other participant is whichever column is not the viewer, so the join
  // and the block filter both have to work off the same expression.
  const otherIdExpr = sql`case when ${conversation.lowUserId} = ${viewerId}
      then ${conversation.highUserId} else ${conversation.lowUserId} end`;

  const conditions = [
    sql`(${conversation.lowUserId} = ${viewerId} or ${conversation.highUserId} = ${viewerId})`,
  ];

  const hidden = await blockedIds(db, viewerId);
  if (hidden.length) {
    conditions.push(
      sql`${otherIdExpr} not in (${sql.join(
        hidden.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  if (cursor) {
    conditions.push(
      sql`(${conversation.lastMessageAt} < ${cursor.score}
        or (${conversation.lastMessageAt} = ${cursor.score} and ${conversation.id} < ${cursor.id}))`,
    );
  }

  const rows = await db
    .select({
      id: conversation.id,
      lowUserId: conversation.lowUserId,
      highUserId: conversation.highUserId,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      lastSenderId: conversation.lastSenderId,
      lowReadAt: conversation.lowReadAt,
      highReadAt: conversation.highReadAt,
      otherUserId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarImageId: profile.avatarImageId,
    })
    .from(conversation)
    .innerJoin(profile, sql`${profile.userId} = ${otherIdExpr}`)
    .where(and(...conditions))
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];

  return {
    conversations: page.map((row) => ({
      id: row.id,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      lastSenderId: row.lastSenderId,
      unread: isUnreadFor(row, viewerId),
      other: {
        userId: row.otherUserId,
        username: row.username,
        displayName: row.displayName,
        avatarImageId: row.avatarImageId,
      },
    })),
    nextCursor:
      rows.length > size && last
        ? encodeCursor({ score: last.lastMessageAt, id: last.id })
        : null,
  };
}

async function blockedIds(db: Db, viewerId: string) {
  const [byMe, ofMe] = await Promise.all([
    db.select({ id: block.blockedId }).from(block).where(eq(block.blockerId, viewerId)),
    db.select({ id: block.blockerId }).from(block).where(eq(block.blockedId, viewerId)),
  ]);
  return [...new Set([...byMe, ...ofMe].map((row) => row.id))];
}

export type ThreadMessage = {
  id: string;
  senderId: string;
  /** Null when the message has been withdrawn — the row itself stays. */
  body: string | null;
  removed: boolean;
  createdAt: number;
};

/**
 * A page of a thread, newest first.
 *
 * Newest first because that is what a phone opens to; the client reverses it
 * for display and asks for the next page when someone scrolls up.
 */
export async function listMessages(
  db: Db,
  conversationId: string,
  viewerId: string,
  rawCursor?: string | null,
  limit = THREAD_PAGE,
): Promise<{ messages: ThreadMessage[]; nextCursor: string | null } | null> {
  const thread = await getThread(db, conversationId, viewerId);
  if (!thread) return null;

  const cursor = decodeCursor(rawCursor);
  const size = Math.min(Math.max(limit, 1), 100);

  const conditions = [eq(message.conversationId, conversationId)];
  if (cursor) {
    conditions.push(
      sql`(${message.createdAt} < ${cursor.score}
        or (${message.createdAt} = ${cursor.score} and ${message.id} < ${cursor.id}))`,
    );
  }

  const rows = await db
    .select({
      id: message.id,
      senderId: message.senderId,
      body: message.body,
      status: message.status,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(and(...conditions))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];

  return {
    // Withdrawn messages keep their place as a tombstone. Silently closing the
    // gap would rewrite a conversation someone may be about to report.
    messages: page.map((row) => ({
      id: row.id,
      senderId: row.senderId,
      body: row.status === "removed" ? null : row.body,
      removed: row.status === "removed",
      createdAt: row.createdAt,
    })),
    nextCursor:
      rows.length > size && last
        ? encodeCursor({ score: last.createdAt, id: last.id })
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Send, and keep the thread's denormalised summary honest.
 *
 * The insert and the summary update go in one batch: D1 runs a batch as a
 * transaction, so an inbox can never show a preview for a message that is not
 * in the thread, nor miss one that is.
 */
export async function sendMessage(
  db: Db,
  input: { conversationId: string; senderId: string; body: string },
): Promise<{ id: string; createdAt: number }> {
  const row = await db.query.conversation.findFirst({
    where: eq(conversation.id, input.conversationId),
  });
  if (!row) throw new MessagingError("no_such_thread");

  const side = sideOf(row, input.senderId);
  if (!side) throw new MessagingError("not_a_participant");

  const recipientId = side === "low" ? row.highUserId : row.lowUserId;
  if (await isBlockedBetween(db, input.senderId, recipientId)) {
    throw new MessagingError("blocked");
  }

  const validated = validateMessageBody(input.body);
  if (!validated.ok) throw new MessagingError("invalid_body");

  const id = newId("ms");
  const nowSeconds = Math.floor(Date.now() / 1000);

  await db.batch([
    db.insert(message).values({
      id,
      conversationId: row.id,
      senderId: input.senderId,
      body: validated.body,
      createdAt: nowSeconds,
    }),
    db
      .update(conversation)
      .set({
        lastMessageAt: nowSeconds,
        lastMessagePreview: messagePreview(validated.body),
        lastSenderId: input.senderId,
        // You have obviously read what you just sent; without this the sender's
        // own thread would light up as unread.
        ...(side === "low" ? { lowReadAt: nowSeconds } : { highReadAt: nowSeconds }),
      })
      .where(eq(conversation.id, row.id)),
  ]);

  /*
   * The notification points at the conversation rather than the message. A
   * single message is not a place anyone can navigate to — a thread is — and
   * the only job of this notification is to open the right one.
   */
  await createNotification(db, {
    userId: recipientId,
    actorId: input.senderId,
    type: "message",
    subjectType: "message",
    subjectId: row.id,
    preview: messagePreview(validated.body),
  });

  return { id, createdAt: nowSeconds };
}

/** Moves this side's read cursor to now. */
export async function markThreadRead(
  db: Db,
  conversationId: string,
  viewerId: string,
): Promise<boolean> {
  const row = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });
  if (!row) return false;

  const side = sideOf(row, viewerId);
  if (!side) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  await db
    .update(conversation)
    .set(side === "low" ? { lowReadAt: nowSeconds } : { highReadAt: nowSeconds })
    .where(eq(conversation.id, row.id));
  return true;
}

/**
 * Withdraw your own message.
 *
 * Soft, always. The row stays exactly as it was so a moderator reading a report
 * sees what was actually sent, not an empty space where it used to be.
 */
export async function deleteMessage(
  db: Db,
  messageId: string,
  viewerId: string,
): Promise<boolean> {
  const row = await db.query.message.findFirst({
    where: eq(message.id, messageId),
  });
  if (!row || row.status === "removed") return false;
  if (row.senderId !== viewerId) return false;

  const thread = await db.query.conversation.findFirst({
    where: eq(conversation.id, row.conversationId),
  });
  if (!thread || !sideOf(thread, viewerId)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const statements: any[] = [
    db
      .update(message)
      .set({ status: "removed", deletedAt: nowSeconds })
      .where(eq(message.id, row.id)),
  ];

  // If this was the line the inbox is showing, the inbox has to stop showing
  // it — in the same batch, or the preview outlives the message it describes.
  if (thread.lastSenderId === viewerId && thread.lastMessagePreview) {
    const isLatest = await db
      .select({ id: message.id })
      .from(message)
      .where(eq(message.conversationId, thread.id))
      .orderBy(desc(message.createdAt), desc(message.id))
      .limit(1);
    if (isLatest[0]?.id === row.id) {
      statements.push(
        db
          .update(conversation)
          .set({ lastMessagePreview: "Message withdrawn" })
          .where(eq(conversation.id, thread.id)),
      );
    }
  }

  await db.batch(statements as [any, ...any[]]);
  return true;
}

/**
 * Is this message one the viewer is entitled to act on — read, report, flag?
 *
 * Returns the message only when the viewer is in its thread. Reporting is the
 * caller that matters: it must not become a way to confirm that a given id
 * exists somewhere in somebody else's inbox.
 */
export async function messageForParticipant(
  db: Db,
  messageId: string,
  viewerId: string,
) {
  const row = await db.query.message.findFirst({
    where: eq(message.id, messageId),
  });
  if (!row) return null;

  const thread = await db.query.conversation.findFirst({
    where: eq(conversation.id, row.conversationId),
  });
  if (!thread || !sideOf(thread, viewerId)) return null;

  return { message: row, conversation: thread };
}
