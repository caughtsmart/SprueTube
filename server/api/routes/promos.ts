import { Hono } from "hono";
import type { ApiEnv } from "../context";
import { pickAd, recordClick, recordImpression } from "../../services/ads";

export const promos = new Hono<ApiEnv>();

promos.get("/ads", async (c) => {
  const slotParam = c.req.query("slot");
  const slot =
    slotParam === "sidebar" || slotParam === "post" ? slotParam : "feed";

  const ad = await pickAd(c.get("db"), slot);
  if (!ad) return c.json({ ad: null });

  c.executionCtx?.waitUntil(
    recordImpression(c.get("db"), ad.id).catch(() => undefined),
  );
  return c.json({ ad });
});

/**
 * Click-through redirect. Counting the click server-side means an ad blocker
 * cannot silently zero the numbers we use to decide what to promote.
 */
promos.get("/ads/:id/click", async (c) => {
  const target = await recordClick(c.get("db"), c.req.param("id"));
  if (!target) return c.redirect("/", 302);
  return c.redirect(target, 302);
});
