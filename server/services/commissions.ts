/*
 * Commission listings — painters advertising that they take work.
 *
 * SprueTube does not take payment, hold money or vet anyone. This module lists
 * people and their prices; everything after "I'll take it" happens between the
 * two of them, exactly as it does in a club. That boundary is why there is no
 * order, invoice or escrow anywhere in here, and it is deliberate rather than
 * unfinished.
 *
 * Money is pence, always. See the commission table's comment for why.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { newId } from "../db/id";
import { block, commission, profile } from "../db/schema";
// The same slug rules as build logs. A second copy would drift, and the day it
// did, two features would disagree about what "Légion d'honneur" is called.
import { slugify } from "../api/routes/content";
import {
  GAME_SYSTEMS,
  MAX_COMMISSION_BLURB_LENGTH,
  MAX_COMMISSION_TITLE_LENGTH,
  PRICE_UNITS,
  type PriceUnit,
} from "../../app/lib/taxonomy";

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/** £100,000. A sanity ceiling on typos, not a view on what anyone may charge. */
const MAX_PRICE_PENCE = 10_000_000;

export type ParsedPrice =
  | { ok: true; pence: number | null }
  | { ok: false; message: string };

/**
 * Pounds as a person types them, to pence as an integer.
 *
 * The form asks for pounds because that is what a painter has in their head,
 * and the conversion happens here rather than in the browser so there is one
 * implementation of it rather than two that disagree at the second decimal
 * place. Blank is `null`, which means "ask" — never zero, which would render
 * as "£0" and read as free work.
 */
export function parsePounds(raw: unknown): ParsedPrice {
  if (raw === null || raw === undefined) return { ok: true, pence: null };
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, message: "Use a number, like 12 or 12.50." };
  }

  const cleaned = String(raw)
    .trim()
    .replace(/^£/, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return { ok: true, pence: null };

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false, message: "Use a number, like 12 or 12.50." };

  // "5" → "50", not "05": a single decimal digit is tenths of a pound.
  const total = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));

  if (total === 0) {
    return {
      ok: false,
      message: "Leave it blank if you would rather people asked.",
    };
  }
  if (!Number.isSafeInteger(total) || total > MAX_PRICE_PENCE) {
    return { ok: false, message: "That is more than this form takes." };
  }

  return { ok: true, pence: total };
}

/** The one range rule worth stating: a price cannot count downwards. */
export function priceRangeError(
  fromPence: number | null,
  toPence: number | null,
): string | null {
  if (fromPence !== null && toPence !== null && fromPence > toPence) {
    return "The lower price is above the upper one.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type CommissionValues = {
  title: string;
  blurb: string;
  priceFromPence: number | null;
  priceToPence: number | null;
  priceUnit: PriceUnit;
  turnaroundDays: number | null;
  gameSystems: string[];
  location: string | null;
  coverImageId: string | null;
  openToWork: boolean;
};

export type CommissionValidation =
  | { ok: true; values: CommissionValues }
  | { ok: false; fields: Record<string, string> };

const MAX_SYSTEMS = 6;

/**
 * The whole form, checked in one pure pass.
 *
 * Written by hand rather than as a Zod schema because the interesting rules —
 * the money parsing and the from/to ordering — are the ones that most want a
 * unit test, and splitting them across a schema and a service would leave the
 * half worth testing sitting behind a request.
 */
export function validateCommission(raw: unknown): CommissionValidation {
  const input = (raw ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const title = text(input.title).slice(0, MAX_COMMISSION_TITLE_LENGTH + 1);
  if (!title) fields.title = "Give the listing a name.";
  else if (title.length > MAX_COMMISSION_TITLE_LENGTH) {
    fields.title = `Keep it under ${MAX_COMMISSION_TITLE_LENGTH} characters.`;
  }

  const blurb = text(input.blurb);
  if (!blurb) fields.blurb = "Say what you paint and how you work.";
  else if (blurb.length > MAX_COMMISSION_BLURB_LENGTH) {
    fields.blurb = `Keep it under ${MAX_COMMISSION_BLURB_LENGTH} characters.`;
  }

  const from = parsePounds(input.priceFrom);
  if (!from.ok) fields.priceFrom = from.message;
  const to = parsePounds(input.priceTo);
  if (!to.ok) fields.priceTo = to.message;

  if (from.ok && to.ok) {
    const rangeProblem = priceRangeError(from.pence, to.pence);
    if (rangeProblem) fields.priceTo = rangeProblem;
  }

  const priceUnit = PRICE_UNITS.includes(input.priceUnit as PriceUnit)
    ? (input.priceUnit as PriceUnit)
    : "model";

  let turnaroundDays: number | null = null;
  if (input.turnaroundDays !== null && input.turnaroundDays !== undefined && input.turnaroundDays !== "") {
    const days = Number(input.turnaroundDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      fields.turnaroundDays = "Give a whole number of days, up to 365.";
    } else {
      turnaroundDays = days;
    }
  }

  const gameSystems = Array.isArray(input.gameSystems)
    ? [...new Set(input.gameSystems.filter(isGameSystem))]
    : [];
  if (gameSystems.length > MAX_SYSTEMS) {
    fields.gameSystems = `Pick up to ${MAX_SYSTEMS}.`;
  }

  const location = text(input.location) || null;
  if (location && location.length > 60) {
    fields.location = "A town or a county is enough.";
  }

  const coverImageId = text(input.coverImageId) || null;
  if (coverImageId && coverImageId.length > 100) {
    fields.coverImageId = "That image reference is not one of ours.";
  }

  if (Object.keys(fields).length) return { ok: false, fields };

  return {
    ok: true,
    values: {
      title,
      blurb,
      priceFromPence: from.ok ? from.pence : null,
      priceToPence: to.ok ? to.pence : null,
      priceUnit,
      turnaroundDays,
      gameSystems,
      location,
      coverImageId,
      openToWork: input.openToWork === undefined ? true : Boolean(input.openToWork),
    },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isGameSystem(value: unknown): value is string {
  return (
    typeof value === "string" && (GAME_SYSTEMS as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Browse cursor                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Three parts, because the browse order is three deep: open to work first, then
 * most recently updated, then id to break ties. OFFSET would drift every time a
 * painter edited a listing mid-scroll.
 */
export type BrowseCursor = { open: 0 | 1; updatedAt: number; id: string } | null;

export function encodeBrowseCursor(cursor: BrowseCursor): string | null {
  if (!cursor) return null;
  return `${cursor.open}~${cursor.updatedAt}~${cursor.id}`;
}

export function decodeBrowseCursor(raw: string | null | undefined): BrowseCursor {
  if (!raw) return null;
  const parts = raw.split("~");
  if (parts.length < 3) return null;

  const open = Number(parts[0]);
  const updatedAt = Number(parts[1]);
  // Ids never contain '~', but rejoining is free insurance against one that does.
  const id = parts.slice(2).join("~");

  if (open !== 0 && open !== 1) return null;
  if (!Number.isFinite(updatedAt) || !id) return null;
  return { open: open as 0 | 1, updatedAt, id };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export type CommissionCard = {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  priceFromPence: number | null;
  priceToPence: number | null;
  priceUnit: PriceUnit;
  turnaroundDays: number | null;
  gameSystems: string[];
  coverImageId: string | null;
  location: string | null;
  openToWork: boolean;
  updatedAt: number;
  owner: {
    username: string;
    displayName: string;
    avatarImageId: string | null;
  };
};

const PAGE_SIZE = 20;

/** Owners the viewer must not see, in either direction. */
async function blockedOwnerIds(db: Db, viewerId: string | null) {
  if (!viewerId) return [] as string[];

  const [byMe, ofMe] = await Promise.all([
    db.select({ id: block.blockedId }).from(block).where(eq(block.blockerId, viewerId)),
    db.select({ id: block.blockerId }).from(block).where(eq(block.blockedId, viewerId)),
  ]);

  return [...new Set([...byMe, ...ofMe].map((row) => row.id))];
}

export async function browseCommissions(
  db: Db,
  options: {
    viewerId: string | null;
    cursor?: string | null;
    gameSystem?: string | null;
    openOnly?: boolean;
    limit?: number;
  },
): Promise<{ commissions: CommissionCard[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const cursor = decodeBrowseCursor(options.cursor);
  const hidden = await blockedOwnerIds(db, options.viewerId);

  const conditions = [
    eq(commission.status, "active"),
    eq(profile.status, "active"),
  ];

  if (options.openOnly) conditions.push(eq(commission.openToWork, true));

  if (options.gameSystem) {
    // json_each rather than a LIKE over the raw text: it matches whole array
    // entries, so "terrain" cannot be found inside some future "terrain-only".
    conditions.push(
      sql`exists (select 1 from json_each(coalesce(${commission.gameSystems}, '[]')) where value = ${options.gameSystem})`,
    );
  }

  if (hidden.length) {
    conditions.push(
      sql`${commission.ownerId} not in (${sql.join(
        hidden.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  if (cursor) {
    conditions.push(
      sql`(${commission.openToWork} < ${cursor.open}
        or (${commission.openToWork} = ${cursor.open} and ${commission.updatedAt} < ${cursor.updatedAt})
        or (${commission.openToWork} = ${cursor.open} and ${commission.updatedAt} = ${cursor.updatedAt} and ${commission.id} < ${cursor.id}))`,
    );
  }

  const rows = await db
    .select({
      id: commission.id,
      slug: commission.slug,
      title: commission.title,
      blurb: commission.blurb,
      priceFromPence: commission.priceFromPence,
      priceToPence: commission.priceToPence,
      priceUnit: commission.priceUnit,
      turnaroundDays: commission.turnaroundDays,
      gameSystems: commission.gameSystems,
      coverImageId: commission.coverImageId,
      location: commission.location,
      openToWork: commission.openToWork,
      updatedAt: commission.updatedAt,
      username: profile.username,
      displayName: profile.displayName,
      avatarImageId: profile.avatarImageId,
    })
    .from(commission)
    .innerJoin(profile, eq(profile.userId, commission.ownerId))
    .where(and(...conditions))
    .orderBy(
      desc(commission.openToWork),
      desc(commission.updatedAt),
      desc(commission.id),
    )
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    commissions: page.map(toCard),
    nextCursor:
      rows.length > limit && last
        ? encodeBrowseCursor({
            open: last.openToWork ? 1 : 0,
            updatedAt: last.updatedAt,
            id: last.id,
          })
        : null,
  };
}

type Row = {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  priceFromPence: number | null;
  priceToPence: number | null;
  priceUnit: PriceUnit;
  turnaroundDays: number | null;
  gameSystems: string[] | null;
  coverImageId: string | null;
  location: string | null;
  openToWork: boolean;
  updatedAt: number;
  username: string;
  displayName: string;
  avatarImageId: string | null;
};

function toCard(row: Row): CommissionCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    blurb: row.blurb,
    priceFromPence: row.priceFromPence,
    priceToPence: row.priceToPence,
    priceUnit: row.priceUnit,
    turnaroundDays: row.turnaroundDays,
    gameSystems: row.gameSystems ?? [],
    coverImageId: row.coverImageId,
    location: row.location,
    openToWork: row.openToWork,
    updatedAt: row.updatedAt,
    owner: {
      username: row.username,
      displayName: row.displayName,
      avatarImageId: row.avatarImageId,
    },
  };
}

export type CommissionDetail = {
  commission: typeof commission.$inferSelect;
  owner: typeof profile.$inferSelect;
  isOwner: boolean;
};

/**
 * One listing, by handle and slug.
 *
 * The username in the URL says whose listing to *fetch*. It never says who is
 * allowed to change it — that comes from the session, in the callers below.
 */
export async function getCommission(
  db: Db,
  username: string,
  slug: string,
  viewerId: string | null,
): Promise<CommissionDetail | null> {
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!owner || owner.status !== "active") return null;

  const isOwner = viewerId === owner.userId;

  if (viewerId && !isOwner) {
    const blocked = await db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        sql`(${block.blockerId} = ${viewerId} and ${block.blockedId} = ${owner.userId})
            or (${block.blockerId} = ${owner.userId} and ${block.blockedId} = ${viewerId})`,
      )
      .limit(1);
    if (blocked.length) return null;
  }

  const row = await db.query.commission.findFirst({
    where: and(eq(commission.ownerId, owner.userId), eq(commission.slug, slug)),
  });
  if (!row || row.status === "removed") return null;
  // A hidden listing is still the owner's to see and edit; to everyone else it
  // is simply not there.
  if (row.status === "hidden" && !isOwner) return null;

  return { commission: row, owner, isOwner };
}

export async function listOwnCommissions(db: Db, ownerId: string) {
  return db
    .select()
    .from(commission)
    .where(
      and(eq(commission.ownerId, ownerId), sql`${commission.status} != 'removed'`),
    )
    .orderBy(desc(commission.updatedAt))
    .limit(50);
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export async function createCommission(
  db: Db,
  ownerId: string,
  values: CommissionValues,
): Promise<{ id: string; slug: string }> {
  const id = newId("cm");
  const slug = await uniqueSlug(db, ownerId, values.title);

  await db.insert(commission).values({
    id,
    ownerId,
    slug,
    title: values.title,
    blurb: values.blurb,
    priceFromPence: values.priceFromPence,
    priceToPence: values.priceToPence,
    priceUnit: values.priceUnit,
    turnaroundDays: values.turnaroundDays,
    gameSystems: values.gameSystems,
    coverImageId: values.coverImageId,
    location: values.location,
    openToWork: values.openToWork,
  });

  return { id, slug };
}

/**
 * @returns the listing's slug, or null when it is not this person's to edit.
 *
 * The slug is deliberately left alone when the title changes. Someone has that
 * URL in a forum signature, and quietly moving it to punish a typo fix is worse
 * than a slug that no longer matches the heading.
 */
export async function updateCommission(
  db: Db,
  commissionId: string,
  ownerId: string,
  values: CommissionValues,
): Promise<string | null> {
  const owned = await db.query.commission.findFirst({
    where: and(eq(commission.id, commissionId), eq(commission.ownerId, ownerId)),
  });
  if (!owned || owned.status === "removed") return null;

  await db
    .update(commission)
    .set({
      title: values.title,
      blurb: values.blurb,
      priceFromPence: values.priceFromPence,
      priceToPence: values.priceToPence,
      priceUnit: values.priceUnit,
      turnaroundDays: values.turnaroundDays,
      gameSystems: values.gameSystems,
      coverImageId: values.coverImageId,
      location: values.location,
      openToWork: values.openToWork,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(commission.id, owned.id));

  return owned.slug;
}

/**
 * The full-book switch.
 *
 * `updatedAt` is deliberately not touched. It is the browse sort key, so
 * bumping it here would let anyone ride the top of the list by flicking the
 * toggle twice a day — and the whole point of this switch is that it costs a
 * painter nothing to be honest about being busy.
 */
export async function setOpenToWork(
  db: Db,
  commissionId: string,
  ownerId: string,
  open: boolean,
): Promise<boolean> {
  const owned = await db.query.commission.findFirst({
    where: and(eq(commission.id, commissionId), eq(commission.ownerId, ownerId)),
  });
  if (!owned || owned.status === "removed") return false;

  await db
    .update(commission)
    .set({ openToWork: open })
    .where(eq(commission.id, owned.id));
  return true;
}

/** Soft delete, so a listing named in a report is still there to be read. */
export async function removeCommission(
  db: Db,
  commissionId: string,
  ownerId: string,
): Promise<boolean> {
  const owned = await db.query.commission.findFirst({
    where: and(eq(commission.id, commissionId), eq(commission.ownerId, ownerId)),
  });
  if (!owned || owned.status === "removed") return false;

  await db
    .update(commission)
    .set({ status: "removed", updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(commission.id, owned.id));
  return true;
}

async function uniqueSlug(db: Db, ownerId: string, title: string) {
  const base = slugify(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.query.commission.findFirst({
      where: and(
        eq(commission.ownerId, ownerId),
        eq(commission.slug, candidate),
      ),
    });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
