/*
 * Advertising.
 *
 * One layer, on purpose: house ads served from D1, every one a Loaded Dice
 * promotion. There is no third-party ad network — AdSense was removed in favour
 * of keeping the whole slot for the shop that funds the site. That means the
 * layout is built against real ad-shaped boxes, there are no ad cookies to ask
 * consent for, and every impression is a referral rather than a few pence of
 * programmatic fill.
 *
 * The feed injects a slot every AD_INTERVAL posts. Any denser and the feed
 * reads as an advert with posts in it.
 */

import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { adPlacement } from "../db/schema";

export const AD_INTERVAL = 6;

export type ServedAd = {
  id: string;
  slot: "feed" | "sidebar" | "post";
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string;
  ctaLabel: string;
};

/**
 * Picks one active ad for a slot, weighted.
 *
 * The pool is small (a handful of promos), so it is cheaper to read them all
 * and choose in memory than to make SQLite do weighted random selection.
 */
export async function pickAd(
  db: Db,
  slot: "feed" | "sidebar" | "post",
  seed?: number,
): Promise<ServedAd | null> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const candidates = await db
    .select()
    .from(adPlacement)
    .where(
      and(
        eq(adPlacement.slot, slot),
        eq(adPlacement.active, true),
        or(isNull(adPlacement.startsAt), lte(adPlacement.startsAt, nowSeconds)),
        or(isNull(adPlacement.endsAt), gte(adPlacement.endsAt, nowSeconds)),
      ),
    )
    .limit(50);

  if (!candidates.length) return null;

  const totalWeight = candidates.reduce(
    (sum, ad) => sum + Math.max(1, ad.weight),
    0,
  );
  // A caller-supplied seed keeps the choice stable within one render pass, so
  // an SSR page and its hydration do not disagree about which ad is showing.
  const roll = ((seed ?? Math.random() * totalWeight) % totalWeight + totalWeight) % totalWeight;

  let running = 0;
  for (const ad of candidates) {
    running += Math.max(1, ad.weight);
    if (roll < running) return toServedAd(ad);
  }
  return toServedAd(candidates[0]!);
}

function toServedAd(ad: typeof adPlacement.$inferSelect): ServedAd {
  return {
    id: ad.id,
    slot: ad.slot,
    title: ad.title,
    body: ad.body,
    imageUrl: ad.imageUrl,
    targetUrl: ad.targetUrl,
    ctaLabel: ad.ctaLabel ?? "Take a look",
  };
}

export async function recordImpression(db: Db, adId: string) {
  await db
    .update(adPlacement)
    .set({ impressions: sql`${adPlacement.impressions} + 1` })
    .where(eq(adPlacement.id, adId));
}

export async function recordClick(db: Db, adId: string) {
  const ad = await db.query.adPlacement.findFirst({
    where: eq(adPlacement.id, adId),
  });
  if (!ad) return null;

  await db
    .update(adPlacement)
    .set({ clicks: sql`${adPlacement.clicks} + 1` })
    .where(eq(adPlacement.id, adId));

  return ad.targetUrl;
}

/**
 * Where ad slots land in a list of N posts.
 *
 * Never index 0 — the first thing a visitor sees should be a miniature someone
 * painted, not an advert. That is also what stops the site reading as a
 * marketing funnel for the shop, which was the point of keeping the brand
 * separate.
 */
export function adSlotIndices(postCount: number): number[] {
  const indices: number[] = [];
  for (let i = AD_INTERVAL; i < postCount; i += AD_INTERVAL) indices.push(i);
  return indices;
}
