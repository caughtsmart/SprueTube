import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import { commission, profile } from "../../db/schema";
import { publicProfile } from "./people";
import {
  browseCommissions,
  createCommission,
  getCommission,
  listOwnCommissions,
  removeCommission,
  setOpenToWork,
  updateCommission,
  validateCommission,
} from "../../services/commissions";

/*
 * Commission listings.
 *
 * The form is validated by validateCommission rather than a Zod schema in
 * ../validators: the rules that matter here are the money ones, and keeping
 * them in the service means they can be unit tested without a request.
 */
export const commissions = new Hono<ApiEnv>();

commissions.get("/commissions", async (c) => {
  const page = await browseCommissions(c.get("db"), {
    viewerId: c.get("user")?.id ?? null,
    cursor: c.req.query("cursor"),
    gameSystem: c.req.query("system") ?? null,
    // Painters with a full book stay listed but sink; this hides them entirely.
    openOnly: c.req.query("open") === "1",
    limit: Number(c.req.query("limit")) || undefined,
  });

  return c.json(page);
});

/** The viewer's own listings, including any they have hidden. */
commissions.get("/commissions/mine", requireAuth, async (c) =>
  c.json({
    commissions: await listOwnCommissions(c.get("db"), c.get("user")!.id),
  }),
);

commissions.post("/commissions", requireAuth, async (c) => {
  await rateLimit(c, "create-commission", { max: 10, windowSeconds: 3600 });

  const parsed = validateCommission(await c.req.json());
  if (!parsed.ok) throw badRequest("Check the form.", { fields: parsed.fields });

  const me = c.get("profile")!;
  if (!me.birthdate) {
    throw apiError(
      403,
      "onboarding_required",
      "Finish setting up your profile first.",
    );
  }

  const created = await createCommission(
    c.get("db"),
    c.get("user")!.id,
    parsed.values,
  );
  return c.json({ ...created, username: me.username }, 201);
});

/**
 * One listing.
 *
 * The username is how the listing is *found*. Whether the person reading it may
 * change it is decided from the session, in the handlers below — never from
 * this segment.
 */
commissions.get("/commissions/:username/:slug", async (c) => {
  const found = await getCommission(
    c.get("db"),
    c.req.param("username"),
    c.req.param("slug"),
    c.get("user")?.id ?? null,
  );
  if (!found) throw apiError(404, "not_found", "No such listing.");

  return c.json({
    commission: found.commission,
    owner: publicProfile(found.owner),
    isOwner: found.isOwner,
  });
});

commissions.patch("/commissions/:id", requireAuth, async (c) => {
  const parsed = validateCommission(await c.req.json());
  if (!parsed.ok) throw badRequest("Check the form.", { fields: parsed.fields });

  const slug = await updateCommission(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    parsed.values,
  );
  if (!slug) throw apiError(404, "not_found", "That listing is not yours.");

  return c.json({ ok: true, slug });
});

/**
 * The open-to-work switch, on its own endpoint.
 *
 * Separate from the edit form on purpose: closing your book at midnight because
 * you are buried should be one tap from the listing, not a trip through a form
 * with a price field on it.
 */
commissions.post("/commissions/:id/open", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { open?: unknown };
  const open = Boolean(body.open);

  const ok = await setOpenToWork(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
    open,
  );
  if (!ok) throw apiError(404, "not_found", "That listing is not yours.");

  return c.json({ openToWork: open });
});

commissions.delete("/commissions/:id", requireAuth, async (c) => {
  const ok = await removeCommission(
    c.get("db"),
    c.req.param("id"),
    c.get("user")!.id,
  );
  if (!ok) throw apiError(404, "not_found", "That listing is not yours.");
  return c.json({ ok: true });
});

/** The listings on a painter's profile. Public, and hidden ones stay hidden. */
commissions.get("/profiles/:username/commissions", async (c) => {
  const db = c.get("db");
  const owner = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username").toLowerCase()}`,
  });
  if (!owner || owner.status !== "active") {
    throw apiError(404, "not_found", "No such painter.");
  }

  const rows = await db
    .select()
    .from(commission)
    .where(
      sql`${commission.ownerId} = ${owner.userId} and ${commission.status} = 'active'`,
    )
    .orderBy(sql`${commission.openToWork} desc, ${commission.updatedAt} desc`)
    .limit(20);

  return c.json({ commissions: rows });
});
