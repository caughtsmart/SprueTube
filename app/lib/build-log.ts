/*
 * The running order of a build log, as pure functions.
 *
 * This lives in app/lib for the same reason taxonomy.ts does: the owner's
 * reorder controls run in the browser and need the same rules the server sorts
 * by, and importing them from server/services/projects.ts would drag Drizzle
 * and the whole schema into the client bundle. Nothing in here imports
 * anything.
 */

/**
 * The ordering rule, in one place:
 *
 *   1. `projectPosition` ascending, nulls last
 *   2. then `publishedAt` ascending
 *   3. then `id` ascending
 *
 * Rule 1 is what makes the manual order sparse. An entry nobody has moved has
 * no position at all, so a build log that has never been reordered costs
 * nothing extra to store and still reads in date order. The consequence — an
 * entry that *has* been given a position sorts ahead of every entry that has
 * not — is deliberate, and it is why the owner UI submits the whole visible
 * order rather than only the pair it swapped.
 *
 * Rule 2 is the point of a build log: oldest first, because the interesting
 * thing is the progression.
 *
 * Rule 3 exists because two entries posted in the same second are otherwise
 * unordered, and an unstable sort would shuffle them between page loads. Ids
 * are time-sortable (see server/db/id.ts), so it is also the right tiebreak.
 *
 * `getProjectEntries` sorts in SQL rather than calling this — it has to, since
 * it pages — so the two are twins that must not drift. The tests in
 * tests/projects.test.ts are the shared statement of what both mean.
 */
export type OrderableEntry = {
  id: string;
  projectPosition: number | null;
  publishedAt: number | null;
};

export function compareEntries(a: OrderableEntry, b: OrderableEntry): number {
  const aUnset = a.projectPosition === null ? 1 : 0;
  const bUnset = b.projectPosition === null ? 1 : 0;
  if (aUnset !== bUnset) return aUnset - bUnset;

  if (!aUnset && a.projectPosition !== b.projectPosition) {
    return a.projectPosition! - b.projectPosition!;
  }

  const aTime = a.publishedAt ?? 0;
  const bTime = b.publishedAt ?? 0;
  if (aTime !== bTime) return aTime - bTime;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortEntries<T extends OrderableEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareEntries);
}

/**
 * Moves one entry one place up or down.
 *
 * Up and down buttons rather than drag and drop, and no library for either. A
 * build log is read on a phone at least as often as a desktop, dragging a card
 * inside a scrolling page is miserable on both, and a button has a name a
 * screen reader can read out.
 *
 * Off either end is a no-op rather than a wrap, because a wrap would send the
 * first entry to the bottom of a two-year log on a mis-tap.
 */
export function moveEntry<T extends { id: string }>(
  entries: readonly T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const from = entries.findIndex((entry) => entry.id === id);
  if (from < 0) return [...entries];

  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= entries.length) return [...entries];

  const next = [...entries];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * Turns a requested running order into the rows to write.
 *
 * Ids that are not in the build log are dropped rather than rejected: a stale
 * tab saving an order for a log that has since lost an entry should still store
 * the part that still makes sense. A duplicate id keeps its first appearance,
 * so a client cannot make one entry fight itself for two positions.
 *
 * Entries the caller left out are not touched at all. Positions are only ever
 * assigned to what was sent, which is what keeps the column sparse.
 */
export function planReorder(
  requestedIds: readonly string[],
  idsInProject: readonly string[],
): { id: string; position: number }[] {
  const known = new Set(idsInProject);
  const seen = new Set<string>();
  const plan: { id: string; position: number }[] = [];

  for (const id of requestedIds) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    plan.push({ id, position: plan.length });
  }

  return plan;
}

/** True when the two lists name the same entries in the same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
