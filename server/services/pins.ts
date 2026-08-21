/*
 * Pins — a person's own shortcuts to the browse axes on the discovery hub.
 *
 * This is not a recommendation signal and it never feeds a ranking. A pin only
 * reorders the game and theme chips for the person who set it, so the shortcuts
 * they actually use sit first. Creators are followed and posts are bookmarked
 * already; pins fill the one gap those left — the games and tags someone keeps
 * coming back to.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pin } from "../db/schema";

export type PinKind = "system" | "tag";

export type Pins = { systems: string[]; tags: string[] };

const EMPTY: Pins = { systems: [], tags: [] };

/** Everything a person has pinned, split by kind, newest first. */
export async function listPins(db: Db, userId: string | null): Promise<Pins> {
  if (!userId) return EMPTY;
  const rows = await db
    .select({ kind: pin.kind, value: pin.value })
    .from(pin)
    .where(eq(pin.userId, userId))
    .orderBy(desc(pin.createdAt));

  const out: Pins = { systems: [], tags: [] };
  for (const row of rows) {
    if (row.kind === "system") out.systems.push(row.value);
    else out.tags.push(row.value);
  }
  return out;
}

/**
 * Adds or removes a pin, idempotently — the composite primary key makes the
 * insert safe to repeat, and a delete of something not there is a no-op.
 */
export async function setPin(
  db: Db,
  userId: string,
  kind: PinKind,
  value: string,
  on: boolean,
): Promise<{ pinned: boolean }> {
  if (on) {
    await db
      .insert(pin)
      .values({ userId, kind, value })
      .onConflictDoNothing();
    return { pinned: true };
  }

  await db
    .delete(pin)
    .where(
      and(eq(pin.userId, userId), eq(pin.kind, kind), eq(pin.value, value)),
    );
  return { pinned: false };
}
