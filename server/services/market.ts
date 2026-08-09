/*
 * The marketplace: things for sale, and things wanted.
 *
 * Listings and contact only. Nothing here takes a payment, holds money, ranks a
 * seller or promises a buyer anything — see the note on the `listing` table for
 * why that line is where it is. The most this module ever does is show an advert
 * and point two people at a conversation.
 *
 * Both kinds live in one table and one browse query, distinguished by `kind`.
 * They are the same shape and they answer the same question ("does anyone have
 * one of these?") from opposite ends, so splitting them would mean two of every
 * query for no gain — but a wanted post and a for-sale post read almost
 * identically at a glance, so everything that renders one has to say which it
 * is. That is why `priceLabel` is computed here rather than in the browser: the
 * label is the main thing distinguishing "£45" from "paying up to £45", and one
 * implementation of it is worth more than a formatted number.
 */

import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import { block, listing, listingMedia, profile } from "../db/schema";
import { decodeCursor, encodeCursor } from "./feed";
import {
  formatPence,
  LISTING_CONDITIONS,
  LISTING_KINDS,
  type ListingCondition,
  type ListingKind,
  type ListingStatus,
} from "../../app/lib/taxonomy";

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A day between bumps.
 *
 * Bumping exists so a seller can raise a listing that has gone quiet without
 * pretending it is new — `bumpedAt` is separate from `createdAt` for exactly
 * that reason. Left ungoverned it becomes a "post to the top" button, and the
 * whole front page turns into whoever is most bored.
 */
export const BUMP_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * £50,000. Not a real limit on anybody's collection, just far enough past a
 * plausible price that a fat-fingered "2400" for £24 stands out.
 */
export const MAX_PRICE_PENCE = 5_000_000;

export type PriceParse =
  | { ok: true; pence: number | null }
  | { ok: false; message: string };

/**
 * Turns what somebody typed into pence.
 *
 * Prices are stored as integer pence everywhere. The arithmetic here is
 * deliberately done on the two halves of the string rather than by multiplying
 * a float — `47.99 * 100` is 4798.9999999999995, and a price that is a penny
 * out is the kind of bug people never quite forgive.
 *
 * Empty input is not an error: on a sale listing no price means "offers", and
 * on a wanted post it means no budget stated. Neither is free, so callers must
 * never render a null as £0.
 */
export function parsePricePounds(input: string | null | undefined): PriceParse {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, pence: null };

  // A leading £ and thousands separators are what people actually type.
  const cleaned = raw.replace(/^£\s*/, "").replace(/,/g, "").trim();

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return {
      ok: false,
      message: "Write the price in pounds, like 24 or 24.50.",
    };
  }

  const [, whole, fraction = ""] = match;
  // Checked before Number() so a 30-digit string cannot lose precision on the
  // way to being rejected.
  if (whole!.length > 9) {
    return { ok: false, message: `Keep it under ${formatPence(MAX_PRICE_PENCE)}.` };
  }

  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (pence > MAX_PRICE_PENCE) {
    return { ok: false, message: `Keep it under ${formatPence(MAX_PRICE_PENCE)}.` };
  }

  return { ok: true, pence };
}

/** Pence back into what the form field should show. The inverse of the above. */
export function penceToPoundsInput(pence: number | null | undefined): string {
  if (pence == null) return "";
  const pounds = Math.trunc(pence / 100);
  const remainder = Math.abs(pence % 100);
  return remainder === 0
    ? String(pounds)
    : `${pounds}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * What the price says on the card.
 *
 * The two kinds need different words for the same number. "£45" on a wanted
 * post reads as though somebody is selling something, which is the single most
 * confusing thing this section could do.
 */
export function formatListingPrice(
  kind: ListingKind,
  pricePence: number | null | undefined,
): string | null {
  if (pricePence == null) {
    // Not free — nobody has said a number yet.
    return kind === "sale" ? "Offers" : null;
  }
  if (pricePence === 0) return "Free";
  const price = formatPence(pricePence)!;
  return kind === "sale" ? price : `Paying up to ${price}`;
}

/**
 * The slug half of /market/:username/:slug.
 *
 * Same rules as a build log's slug, with its own fallback: a listing titled
 * entirely in emoji still needs a URL, and "listing" says what it is.
 */
export function listingSlug(title: string): string {
  return (
    title
      .toLowerCase()
      // NFKD splits an accented letter into letter plus combining mark; dropping
      // the marks gives "legion" rather than "le-gion".
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "listing"
  );
}

export type ListingFilters = {
  kind: ListingKind | null;
  gameSystem: string | null;
  condition: ListingCondition | null;
};

export const NO_FILTERS: ListingFilters = {
  kind: null,
  gameSystem: null,
  condition: null,
};

/**
 * Reads the browse filters off a query string.
 *
 * Anything unrecognised is dropped rather than rejected. These URLs get shared,
 * shortened and hand-edited, and a stale `?condition=mint` should show
 * everything rather than an error page.
 */
export function parseListingFilters(input: {
  kind?: string | null;
  system?: string | null;
  condition?: string | null;
}): ListingFilters {
  const kind = LISTING_KINDS.find((value) => value === input.kind) ?? null;
  const condition =
    LISTING_CONDITIONS.find((value) => value === input.condition) ?? null;
  const gameSystem = input.system?.trim() ? input.system.trim() : null;

  return { kind, gameSystem, condition };
}

/**
 * The filters as a query string, for both the browse links and the "load more"
 * call. Only the keys that are set, so a bare /market stays a bare /market.
 */
export function filtersToQuery(filters: ListingFilters): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.gameSystem) params.set("system", filters.gameSystem);
  if (filters.condition) params.set("condition", filters.condition);
  return params.toString();
}

/** Whether a listing is allowed to be bumped again yet. */
export function canBump(
  bumpedAt: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return now - bumpedAt >= BUMP_INTERVAL_SECONDS;
}

/** How long until it can be, in whole hours. Zero once it is allowed. */
export function hoursUntilBump(
  bumpedAt: number,
  now = Math.floor(Date.now() / 1000),
): number {
  const remaining = bumpedAt + BUMP_INTERVAL_SECONDS - now;
  return remaining <= 0 ? 0 : Math.ceil(remaining / 3600);
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 24;

export type ListingSeller = {
  userId: string;
  username: string;
  displayName: string;
  avatarImageId: string | null;
};

export type ListingSummary = {
  id: string;
  kind: ListingKind;
  slug: string;
  title: string;
  pricePence: number | null;
  priceLabel: string | null;
  condition: ListingCondition | null;
  gameSystem: string | null;
  scale: string | null;
  location: string | null;
  postageOffered: boolean;
  status: ListingStatus;
  bumpedAt: number;
  createdAt: number;
  seller: ListingSeller;
  /** First photo only — the card shows one. */
  imageId: string | null;
};

export type ListingPage = {
  listings: ListingSummary[];
  nextCursor: string | null;
};

export type ListingDetail = ListingSummary & {
  body: string | null;
  viewCount: number;
  updatedAt: number;
  media: {
    id: string;
    imageId: string;
    width: number | null;
    height: number | null;
    altText: string | null;
  }[];
};

/**
 * Sellers the viewer must not see, and who must not see them.
 *
 * Blocks only, both directions. A mute deliberately does not apply here: a mute
 * means "keep them out of my feed", not "hide the thing I might want to buy",
 * and someone who muted a prolific poster has not asked to be cut out of the
 * classifieds.
 */
async function hiddenSellerIds(db: Db, viewerId: string | null) {
  if (!viewerId) return [] as string[];

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

function toSummary(
  row: { listing: typeof listing.$inferSelect; seller: ListingSeller },
  imageId: string | null,
): ListingSummary {
  const kind = row.listing.kind;
  return {
    id: row.listing.id,
    kind,
    slug: row.listing.slug,
    title: row.listing.title,
    pricePence: row.listing.pricePence,
    priceLabel: formatListingPrice(kind, row.listing.pricePence),
    condition: row.listing.condition,
    gameSystem: row.listing.gameSystem,
    scale: row.listing.scale,
    location: row.listing.location,
    postageOffered: row.listing.postageOffered,
    status: row.listing.status as ListingStatus,
    bumpedAt: row.listing.bumpedAt,
    createdAt: row.listing.createdAt,
    seller: row.seller,
    imageId,
  };
}

/**
 * Browse, newest bump first.
 *
 * Keyset pagination on (bumpedAt, id) rather than OFFSET: the list is reordered
 * every time anybody bumps anything, and an offset page boundary would show the
 * same listing twice or skip one entirely as soon as that happened.
 */
export async function listListings(
  db: Db,
  options: {
    viewerId: string | null;
    filters?: ListingFilters;
    /** Restrict to one person's listings. */
    sellerId?: string | null;
    /** Sold and withdrawn as well as open. Only ever true for your own list. */
    includeClosed?: boolean;
    cursor?: string | null;
    limit?: number;
  },
): Promise<ListingPage> {
  const limit = Math.min(options.limit ?? PAGE_SIZE, 50);
  const filters = options.filters ?? NO_FILTERS;
  const cursor = decodeCursor(options.cursor);

  const where = [
    options.includeClosed
      ? // "removed" is a moderator's doing and stays hidden from everyone,
        // including the seller — the seller gets told separately.
        inArray(listing.status, ["open", "sold", "withdrawn"])
      : eq(listing.status, "open"),
  ];

  if (options.sellerId) where.push(eq(listing.sellerId, options.sellerId));
  if (filters.kind) where.push(eq(listing.kind, filters.kind));
  if (filters.gameSystem) where.push(eq(listing.gameSystem, filters.gameSystem));
  if (filters.condition) where.push(eq(listing.condition, filters.condition));

  const hidden = await hiddenSellerIds(db, options.viewerId);
  if (hidden.length) where.push(notInArray(listing.sellerId, hidden));

  if (cursor) {
    where.push(
      or(
        lt(listing.bumpedAt, cursor.score),
        and(eq(listing.bumpedAt, cursor.score), lt(listing.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      listing,
      seller: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
    })
    .from(listing)
    .innerJoin(profile, eq(profile.userId, listing.sellerId))
    .where(and(...where))
    .orderBy(desc(listing.bumpedAt), desc(listing.id))
    // One extra row answers "is there another page?" without a count query.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (!page.length) return { listings: [], nextCursor: null };

  // One query for every cover photo on the page rather than one per listing.
  const covers = await db
    .select({
      listingId: listingMedia.listingId,
      imageId: listingMedia.imageId,
      position: listingMedia.position,
    })
    .from(listingMedia)
    .where(
      inArray(
        listingMedia.listingId,
        page.map((row) => row.listing.id),
      ),
    )
    .orderBy(listingMedia.position);

  const coverByListing = new Map<string, string>();
  for (const cover of covers) {
    if (!coverByListing.has(cover.listingId)) {
      coverByListing.set(cover.listingId, cover.imageId);
    }
  }

  const last = page[page.length - 1]!;

  return {
    listings: page.map((row) =>
      toSummary(row, coverByListing.get(row.listing.id) ?? null),
    ),
    nextCursor: hasMore
      ? encodeCursor({ score: last.listing.bumpedAt, id: last.listing.id })
      : null,
  };
}

/** One listing by seller handle and slug, with its photos. */
export async function getListing(
  db: Db,
  username: string,
  slug: string,
  viewerId: string | null,
): Promise<{ listing: ListingDetail; isOwner: boolean } | null> {
  const rows = await db
    .select({
      listing,
      seller: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarImageId: profile.avatarImageId,
      },
    })
    .from(listing)
    .innerJoin(profile, eq(profile.userId, listing.sellerId))
    .where(
      and(
        sql`lower(${profile.username}) = ${username.toLowerCase()}`,
        eq(listing.slug, slug),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const isOwner = viewerId != null && viewerId === row.listing.sellerId;

  // A listing a moderator has removed is gone for everybody, its seller
  // included — they are told by notification, not by the page pretending
  // nothing happened.
  if (row.listing.status === "removed") return null;

  if (viewerId && !isOwner) {
    const blocked = await db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        or(
          and(
            eq(block.blockerId, viewerId),
            eq(block.blockedId, row.listing.sellerId),
          ),
          and(
            eq(block.blockerId, row.listing.sellerId),
            eq(block.blockedId, viewerId),
          ),
        ),
      )
      .limit(1);
    if (blocked.length) return null;
  }

  const media = await db
    .select()
    .from(listingMedia)
    .where(eq(listingMedia.listingId, row.listing.id))
    .orderBy(listingMedia.position);

  return {
    listing: {
      ...toSummary(row, media[0]?.imageId ?? null),
      body: row.listing.body,
      viewCount: row.listing.viewCount,
      updatedAt: row.listing.updatedAt,
      media: media.map((item) => ({
        id: item.id,
        imageId: item.imageId,
        width: item.width,
        height: item.height,
        altText: item.altText,
      })),
    },
    isOwner,
  };
}

export type ListingImageInput = {
  imageId: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
};

export type ListingInput = {
  kind: ListingKind;
  title: string;
  body: string | null;
  pricePence: number | null;
  condition: ListingCondition | null;
  gameSystem: string | null;
  scale: string | null;
  location: string | null;
  postageOffered: boolean;
  images: ListingImageInput[];
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function mediaRows(listingId: string, images: ListingImageInput[]) {
  return images.map((image, position) => ({
    id: newId("lm"),
    listingId,
    position,
    imageId: image.imageId,
    width: image.width ?? null,
    height: image.height ?? null,
    altText: image.altText ?? null,
  }));
}

export async function createListing(
  db: Db,
  sellerId: string,
  input: ListingInput,
): Promise<{ id: string; slug: string }> {
  const id = newId("lst");
  const slug = await uniqueSlug(db, sellerId, input.title);

  await db.insert(listing).values({
    id,
    sellerId,
    kind: input.kind,
    slug,
    title: input.title,
    body: input.body,
    pricePence: input.pricePence,
    condition: input.condition,
    gameSystem: input.gameSystem,
    scale: input.scale,
    location: input.location,
    postageOffered: input.postageOffered,
  });

  if (input.images.length) {
    await db.insert(listingMedia).values(mediaRows(id, input.images));
  }

  return { id, slug };
}

/**
 * Edit. Ownership is the `sellerId` in the where clause and nothing else — the
 * username in the URL is decoration and is never consulted.
 *
 * The slug is left alone even when the title changes: the URL has been shared
 * by then, and a renamed listing that 404s for everyone who saved it is a worse
 * outcome than a slug that reads slightly out of date.
 */
export async function updateListing(
  db: Db,
  listingId: string,
  sellerId: string,
  input: ListingInput,
): Promise<boolean> {
  const owned = await db.query.listing.findFirst({
    where: and(eq(listing.id, listingId), eq(listing.sellerId, sellerId)),
  });
  if (!owned || owned.status === "removed") return false;

  await db
    .update(listing)
    .set({
      kind: input.kind,
      title: input.title,
      body: input.body,
      pricePence: input.pricePence,
      condition: input.condition,
      gameSystem: input.gameSystem,
      scale: input.scale,
      location: input.location,
      postageOffered: input.postageOffered,
      // Deliberately not bumpedAt. Editing a typo is not a bump.
      updatedAt: nowSeconds(),
    })
    .where(eq(listing.id, listingId));

  // The photo set is sent whole, so replace it whole. Diffing image ids would
  // save a couple of writes and lose the ordering, which is the one thing about
  // a set of photos the seller actually arranged.
  await db.delete(listingMedia).where(eq(listingMedia.listingId, listingId));
  if (input.images.length) {
    await db.insert(listingMedia).values(mediaRows(listingId, input.images));
  }

  return true;
}

/**
 * Open, sold or withdrawn.
 *
 * Marking something sold is the most common action on this whole feature and
 * the one people skip, which is how a classifieds section fills up with things
 * that went months ago. It is one call, one click, no confirmation.
 */
export async function setListingStatus(
  db: Db,
  listingId: string,
  sellerId: string,
  status: ListingStatus,
): Promise<boolean> {
  const owned = await db.query.listing.findFirst({
    where: and(eq(listing.id, listingId), eq(listing.sellerId, sellerId)),
  });
  if (!owned || owned.status === "removed") return false;

  await db
    .update(listing)
    .set({ status, updatedAt: nowSeconds() })
    .where(eq(listing.id, listingId));

  return true;
}

export type BumpResult =
  | { ok: true; bumpedAt: number }
  | { ok: false; reason: "not_found" | "too_soon" | "not_open"; hours?: number };

export async function bumpListing(
  db: Db,
  listingId: string,
  sellerId: string,
  now = nowSeconds(),
): Promise<BumpResult> {
  const owned = await db.query.listing.findFirst({
    where: and(eq(listing.id, listingId), eq(listing.sellerId, sellerId)),
  });
  if (!owned || owned.status === "removed") return { ok: false, reason: "not_found" };
  if (owned.status !== "open") return { ok: false, reason: "not_open" };

  // The per-listing limit lives here rather than in the KV rate limiter: the
  // limiter counts a person's actions, and the rule is about this one listing.
  if (!canBump(owned.bumpedAt, now)) {
    return { ok: false, reason: "too_soon", hours: hoursUntilBump(owned.bumpedAt, now) };
  }

  await db
    .update(listing)
    .set({ bumpedAt: now, updatedAt: now })
    .where(eq(listing.id, listingId));

  return { ok: true, bumpedAt: now };
}

export async function deleteListing(
  db: Db,
  listingId: string,
  sellerId: string,
): Promise<boolean> {
  const owned = await db.query.listing.findFirst({
    where: and(eq(listing.id, listingId), eq(listing.sellerId, sellerId)),
  });
  if (!owned) return false;

  // listing_media cascades on the foreign key.
  await db.delete(listing).where(eq(listing.id, listingId));
  return true;
}

/** Fire-and-forget from the detail page; never worth failing a request over. */
export async function recordListingView(db: Db, listingId: string) {
  await db
    .update(listing)
    .set({ viewCount: sql`${listing.viewCount} + 1` })
    .where(eq(listing.id, listingId));
}

async function uniqueSlug(db: Db, sellerId: string, title: string) {
  const base = listingSlug(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.query.listing.findFirst({
      where: and(eq(listing.sellerId, sellerId), eq(listing.slug, candidate)),
    });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
