import { Hono } from "hono";
import { z } from "zod";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import {
  bumpListing,
  createListing,
  deleteListing,
  listListings,
  parseListingFilters,
  parsePricePounds,
  setListingStatus,
  updateListing,
  type ListingInput,
} from "../../services/market";
import {
  GAME_SYSTEMS,
  LISTING_CONDITIONS,
  LISTING_KINDS,
  LISTING_STATUSES,
  MAX_IMAGES_PER_LISTING,
  MAX_LISTING_BODY_LENGTH,
  MAX_LISTING_TITLE_LENGTH,
  REPORT_REASONS,
  SCALES,
} from "../../../app/lib/taxonomy";

/*
 * Buying, selling and wanted posts.
 *
 * The validators live here rather than in server/api/validators.ts because the
 * price arrives as the string somebody typed into a form — "£24.50", "24", ""
 * — and is turned into pence by one function on the way in. Splitting the
 * schema from that conversion is how a marketplace ends up with two ideas of
 * what a price is.
 */
export const market = new Hono<ApiEnv>();

const imageSchema = z.object({
  imageId: z.string().min(1).max(100),
  width: z.number().int().positive().max(20000).nullish(),
  height: z.number().int().positive().max(20000).nullish(),
  altText: z.string().trim().max(400).nullish(),
});

const listingSchema = z.object({
  kind: z.enum(LISTING_KINDS),
  title: z.string().trim().min(1).max(MAX_LISTING_TITLE_LENGTH),
  body: z
    .string()
    .trim()
    .max(MAX_LISTING_BODY_LENGTH)
    .nullish()
    .transform((value) => (value ? value : null)),
  /** Pounds, as typed. Converted to pence below; never stored as written. */
  price: z.string().trim().max(20).nullish(),
  condition: z.enum(LISTING_CONDITIONS).nullish(),
  gameSystem: z.enum(GAME_SYSTEMS).nullish(),
  scale: z.enum(SCALES).nullish(),
  /** A town, not an address — see the field's help text on the form. */
  location: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((value) => (value ? value : null)),
  postageOffered: z.boolean().default(false),
  images: z.array(imageSchema).max(MAX_IMAGES_PER_LISTING).default([]),
});

const statusSchema = z.object({ status: z.enum(LISTING_STATUSES) });

/** Shared by create and edit: parse the form, convert the price, or explain. */
function readListingBody(raw: unknown): ListingInput {
  const parsed = listingSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Check the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const price = parsePricePounds(parsed.data.price);
  if (!price.ok) {
    throw badRequest(price.message, { fields: { price: price.message } });
  }

  return {
    kind: parsed.data.kind,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    pricePence: price.pence,
    condition: parsed.data.condition ?? null,
    gameSystem: parsed.data.gameSystem ?? null,
    scale: parsed.data.scale ?? null,
    location: parsed.data.location ?? null,
    postageOffered: parsed.data.postageOffered,
    images: parsed.data.images.map((image) => ({
      imageId: image.imageId,
      width: image.width ?? null,
      height: image.height ?? null,
      altText: image.altText ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Browse                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Both kinds in one list, newest bump first.
 *
 * `mine=1` is the seller's own view and the only way to see something sold or
 * withdrawn — closed listings are off the public boards the moment they close.
 */
market.get("/listings", async (c) => {
  const mine = c.req.query("mine") === "1";
  const viewerId = c.get("user")?.id ?? null;
  if (mine && !viewerId) throw apiError(401, "unauthorized", "Sign in to do that.");

  const page = await listListings(c.get("db"), {
    viewerId,
    filters: parseListingFilters({
      kind: c.req.query("kind"),
      system: c.req.query("system"),
      condition: c.req.query("condition"),
    }),
    sellerId: mine ? viewerId : null,
    includeClosed: mine,
    cursor: c.req.query("cursor"),
    limit: Number(c.req.query("limit")) || undefined,
  });

  return c.json(page);
});

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

market.post("/listings", requireAuth, async (c) => {
  // Enough for somebody clearing out a cupboard in one evening, not enough to
  // paper the board with the same kit forty times.
  await rateLimit(c, "create-listing", { max: 20, windowSeconds: 3600 });

  const me = c.get("profile")!;
  if (!me.birthdate) {
    throw apiError(
      403,
      "onboarding_required",
      "Finish setting up your profile before posting a listing.",
    );
  }

  const input = readListingBody(await c.req.json());
  const created = await createListing(c.get("db"), c.get("user")!.id, input);

  return c.json({ ...created, username: me.username }, 201);
});

/*
 * Every write below finds the row by id *and* seller id. The username in the
 * page URL is never consulted — it is there so the link reads sensibly, and a
 * URL segment is not an authorisation check.
 */

market.patch("/listings/:id", requireAuth, async (c) => {
  const input = readListingBody(await c.req.json());
  const ok = await updateListing(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    input,
  );
  if (!ok) throw apiError(404, "not_found", "That listing is not yours to edit.");
  return c.json({ ok: true });
});

/** Mark as sold, withdraw, or put it back up. One click, no confirmation. */
market.post("/listings/:id/status", requireAuth, async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("Unknown status.");

  const ok = await setListingStatus(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    parsed.data.status,
  );
  if (!ok) throw apiError(404, "not_found", "That listing is not yours.");
  return c.json({ ok: true, status: parsed.data.status });
});

/**
 * Raise a stale listing.
 *
 * Two limits, doing different jobs: the KV counter stops one account bumping a
 * hundred listings in a loop, and the per-listing day is enforced against
 * `bumpedAt` in the service, where it cannot be lost to an eventually
 * consistent counter.
 */
market.post("/listings/:id/bump", requireAuth, async (c) => {
  await rateLimit(c, "bump-listing", { max: 30, windowSeconds: 86400 });

  const result = await bumpListing(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );

  if (!result.ok) {
    if (result.reason === "too_soon") {
      throw apiError(
        429,
        "bump_too_soon",
        `Listings can be bumped once a day. Try again in about ${result.hours} ${
          result.hours === 1 ? "hour" : "hours"
        }.`,
      );
    }
    if (result.reason === "not_open") {
      throw badRequest("Only an open listing can be bumped.");
    }
    throw apiError(404, "not_found", "That listing is not yours.");
  }

  return c.json({ ok: true, bumpedAt: result.bumpedAt });
});

market.delete("/listings/:id", requireAuth, async (c) => {
  const ok = await deleteListing(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw apiError(404, "not_found", "That listing is not yours to delete.");
  return c.json({ ok: true });
});

