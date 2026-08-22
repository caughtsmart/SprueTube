/*
 * Community painting prompts.
 *
 * A challenge names a theme and a tag; the entries are simply the posts that
 * carry the tag, so there is nothing to enter, nothing to judge and no timer to
 * miss. It exists to answer "I have nothing finished, what do I post?" — the
 * single most useful thing a quiet community can offer someone (docs/ROADMAP.md
 * lists weekly prompts as a first-hundred-people mechanic).
 *
 * DB-driven with no admin screen yet, exactly like house ads: a new prompt is
 * an INSERT. See scripts/seed.sql for the shape and the first one.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { challenge, tag } from "../db/schema";

export type ActiveChallenge = {
  id: string;
  slug: string;
  title: string;
  prompt: string;
  tag: string;
  endsAt: number | null;
  /** Posts carrying the tag, all-time — a soft indicator, not a scoreboard. */
  entryCount: number;
};

/**
 * The prompts running right now, soonest to close first.
 *
 * "Running" means active, started (or no start), and not past its close (or no
 * close). The close is a display nicety — a lapsed prompt drops off the hub but
 * nothing about a person's posts changes when it does.
 */
export async function getActiveChallenges(
  db: Db,
  options: { now?: number; limit?: number } = {},
): Promise<ActiveChallenge[]> {
  const nowSeconds = options.now ?? Math.floor(Date.now() / 1000);
  const limit = options.limit ?? 3;

  const rows = await db
    .select({
      id: challenge.id,
      slug: challenge.slug,
      title: challenge.title,
      prompt: challenge.prompt,
      tag: challenge.tag,
      endsAt: challenge.endsAt,
    })
    .from(challenge)
    .where(
      and(
        eq(challenge.active, true),
        or(isNull(challenge.startsAt), lte(challenge.startsAt, nowSeconds)),
        or(isNull(challenge.endsAt), gte(challenge.endsAt, nowSeconds)),
      ),
    )
    // Ending soonest first; a prompt with no close date sorts after dated ones.
    .orderBy(asc(challenge.endsAt), desc(challenge.createdAt))
    .limit(limit);

  if (!rows.length) return [];

  // One lookup for the entry counts, from the tag counters the feed keeps.
  const names = [...new Set(rows.map((r) => r.tag.toLowerCase()))];
  const tagRows = await db
    .select({ name: tag.name, postCount: tag.postCount })
    .from(tag)
    .where(inArray(tag.name, names));
  const countByTag = new Map(tagRows.map((t) => [t.name, t.postCount]));

  return rows.map((row) => ({
    ...row,
    entryCount: countByTag.get(row.tag.toLowerCase()) ?? 0,
  }));
}
