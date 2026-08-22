import { Hono } from "hono";
import { badRequest, requireAuth, type ApiEnv } from "../context";
import { listPins, setPin } from "../../services/pins";
import { normalisePin, pinSchema } from "../validators";

export const pins = new Hono<ApiEnv>();

/**
 * A person's pinned games and themes. Signed-in only — a pin belongs to
 * someone. Public browsing needs no pins, so the endpoint is not open.
 */
pins.get("/pins", requireAuth, async (c) => {
  const result = await listPins(c.get("db"), c.get("user")!.id);
  return c.json(result);
});

pins.post("/pins", requireAuth, async (c) => {
  const parsed = pinSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("That is not something you can pin.");

  const clean = normalisePin(parsed.data);
  if (!clean) throw badRequest("That is not something you can pin.");

  await setPin(c.get("db"), c.get("user")!.id, clean.kind, clean.value, true);
  return c.json({ pinned: true });
});

pins.delete("/pins", requireAuth, async (c) => {
  const parsed = pinSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("That is not something you can pin.");

  const clean = normalisePin(parsed.data);
  if (!clean) throw badRequest("That is not something you can pin.");

  await setPin(c.get("db"), c.get("user")!.id, clean.kind, clean.value, false);
  return c.json({ pinned: false });
});
