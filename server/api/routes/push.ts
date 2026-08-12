import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  type ApiContext,
  type ApiEnv,
} from "../context";
import { newId } from "../../db/id";
import { notificationPref, pushSubscription } from "../../db/schema";
import {
  notificationPrefSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "../validators";

/*
 * Web Push subscriptions and notification preferences.
 *
 * The browser does the subscribing — it talks to its own push service and hands
 * us the endpoint and keys — so all this route does is store what it is given,
 * keyed to the signed-in account, and flip the master switch on.
 */
export const push = new Hono<ApiEnv>();

/** The public VAPID key, so the client can subscribe. Null ⇒ push is off. */
push.get("/push/config", (c) =>
  c.json({ vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null }),
);

/** The person's current preferences, defaulted when they have never set any. */
push.get("/push/preferences", requireAuth, async (c) => {
  const pref = await c.get("db").query.notificationPref.findFirst({
    where: eq(notificationPref.userId, c.get("user")!.id),
  });
  return c.json({
    pushEnabled: pref?.pushEnabled ?? false,
    emailDigest: pref?.emailDigest ?? "weekly",
    mutedTypes: pref?.mutedTypes ?? [],
  });
});

push.patch("/push/preferences", requireAuth, async (c) => {
  const parsed = notificationPrefSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Those settings did not look right.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const userId = c.get("user")!.id;
  const changes: Record<string, unknown> = { updatedAt: nowSeconds() };
  if (parsed.data.emailDigest !== undefined) {
    changes.emailDigest = parsed.data.emailDigest;
  }
  if (parsed.data.mutedTypes !== undefined) {
    changes.mutedTypes = parsed.data.mutedTypes;
  }

  await upsertPref(c, userId, changes);
  return c.json({ ok: true });
});

/**
 * Store a subscription for this browser. Idempotent on the endpoint: the same
 * browser re-subscribing (after a key rotation, say) updates the row it already
 * owns rather than piling up duplicates that would each get the same push.
 *
 * Subscribing is the moment a person has clicked "allow", so it is also where
 * the master switch goes on.
 */
push.post("/push/subscribe", requireAuth, async (c) => {
  await rateLimit(c, "push-subscribe", { max: 30, windowSeconds: 3600 });

  const parsed = pushSubscribeSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("That subscription was not valid.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const db = c.get("db");
  const userId = c.get("user")!.id;
  const { endpoint, keys } = parsed.data;
  const userAgent = c.req.header("user-agent")?.slice(0, 400) ?? null;

  await db
    .insert(pushSubscription)
    .values({
      id: newId("push"),
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        // Re-point the endpoint at whoever is signed in now — a shared device
        // that changed hands should not keep pushing to the previous account.
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        failureCount: 0,
      },
    });

  await upsertPref(c, userId, { pushEnabled: true, updatedAt: nowSeconds() });

  return c.json({ ok: true }, 201);
});

/**
 * Drop one browser's subscription. Deleting the row, not just flipping the
 * switch, because the switch is per-account and a person may still want push on
 * their phone after turning it off on a shared laptop. The last device going
 * quiet does not force the master switch off; the next subscribe turns it back
 * on regardless.
 */
push.post("/push/unsubscribe", requireAuth, async (c) => {
  const parsed = pushUnsubscribeSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("That subscription was not valid.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  await c
    .get("db")
    .delete(pushSubscription)
    .where(eq(pushSubscription.endpoint, parsed.data.endpoint));

  return c.json({ ok: true });
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create the preference row or merge into it. The person may never have touched
 * a setting, so the first write has to insert; `onConflictDoUpdate` keeps it to
 * one round trip.
 */
async function upsertPref(
  c: ApiContext,
  userId: string,
  changes: Record<string, unknown>,
) {
  await c
    .get("db")
    .insert(notificationPref)
    .values({ userId, ...changes })
    .onConflictDoUpdate({ target: notificationPref.userId, set: changes });
}
