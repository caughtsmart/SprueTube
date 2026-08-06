import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  requireAuth,
  type ApiContext,
  type ApiEnv,
} from "../context";
import { follow, notification, profile, pushToken } from "../../db/schema";
import { newId } from "../../db/id";
import { getProfilePosts } from "../../services/feed";
import { setFollow } from "../../services/posts";
import {
  ageFromBirthdate,
  MINIMUM_AGE,
  setBlock,
  setMute,
} from "../../services/moderation";
import {
  isUsernameAvailable,
  usernameProblemMessage,
  validateUsername,
} from "../../services/usernames";
import {
  onboardingSchema,
  profileUpdateSchema,
  pushTokenSchema,
} from "../validators";

export const people = new Hono<ApiEnv>();

/** Everything the client needs about the signed-in viewer, in one call. */
people.get("/me", async (c) => {
  const user = c.get("user");
  const me = c.get("profile");
  if (!user || !me) return c.json({ user: null, profile: null });

  const db = c.get("db");
  const [unread] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notification)
    .where(
      and(eq(notification.userId, user.id), sql`${notification.readAt} is null`),
    );

  return c.json({
    user: { id: user.id, email: user.email, emailVerified: user.emailVerified },
    profile: publicProfile(me, { self: true }),
    // Signup creates a provisional username and no birthdate; until onboarding
    // is done the client should send the user there rather than to the feed.
    needsOnboarding: !me.birthdate,
    unreadNotifications: unread?.count ?? 0,
  });
});

people.post("/onboarding", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;

  const parsed = onboardingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }
  const input = parsed.data;

  const problem = validateUsername(input.username);
  if (problem) {
    throw badRequest("Check the form.", {
      fields: { username: usernameProblemMessage(problem) },
    });
  }
  if (!(await isUsernameAvailable(db, input.username, user.id))) {
    throw badRequest("Check the form.", {
      fields: { username: "That username is taken." },
    });
  }

  const age = ageFromBirthdate(input.birthdate);
  if (age === null) {
    throw badRequest("Check the form.", {
      fields: { birthdate: "That date does not look right." },
    });
  }
  if (age < MINIMUM_AGE) {
    // Do not create the profile and do not keep the date beyond this check.
    throw apiError(
      403,
      "underage",
      `You need to be ${MINIMUM_AGE} or over to use SprueTube.`,
    );
  }

  await db
    .update(profile)
    .set({
      username: input.username,
      displayName: input.displayName,
      bio: input.bio ?? null,
      birthdate: input.birthdate,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(profile.userId, user.id));

  return c.json({ ok: true, username: input.username });
});

people.get("/usernames/:username/available", async (c) => {
  const name = c.req.param("username");
  const problem = validateUsername(name);
  if (problem) {
    return c.json({ available: false, reason: usernameProblemMessage(problem) });
  }
  const available = await isUsernameAvailable(
    c.get("db"),
    name,
    c.get("user")?.id,
  );
  return c.json({
    available,
    reason: available ? null : "That username is taken.",
  });
});

people.patch("/profile", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;

  const parsed = profileUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Check the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }
  const input = parsed.data;

  await db
    .update(profile)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.bio !== undefined ? { bio: input.bio ?? null } : {}),
      ...(input.location !== undefined ? { location: input.location ?? null } : {}),
      ...(input.websiteUrl !== undefined
        ? { websiteUrl: input.websiteUrl ?? null }
        : {}),
      ...(input.pronouns !== undefined ? { pronouns: input.pronouns ?? null } : {}),
      ...(input.systems !== undefined ? { systems: input.systems } : {}),
      ...(input.avatarImageId !== undefined
        ? { avatarImageId: input.avatarImageId ?? null }
        : {}),
      ...(input.bannerImageId !== undefined
        ? { bannerImageId: input.bannerImageId ?? null }
        : {}),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(profile.userId, user.id));

  const updated = await db.query.profile.findFirst({
    where: eq(profile.userId, user.id),
  });
  return c.json({ profile: publicProfile(updated!, { self: true }) });
});

people.get("/profiles/:username", async (c) => {
  const db = c.get("db");
  const viewer = c.get("user");
  const username = c.req.param("username");

  const row = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!row || row.status === "deleted") {
    throw apiError(404, "not_found", "No such painter.");
  }

  let viewerFollows = false;
  let followsViewer = false;
  if (viewer && viewer.id !== row.userId) {
    const edges = await db
      .select({ followerId: follow.followerId, followeeId: follow.followeeId })
      .from(follow)
      .where(
        sql`(${follow.followerId} = ${viewer.id} and ${follow.followeeId} = ${row.userId})
            or (${follow.followerId} = ${row.userId} and ${follow.followeeId} = ${viewer.id})`,
      );
    viewerFollows = edges.some((e) => e.followerId === viewer.id);
    followsViewer = edges.some((e) => e.followerId === row.userId);
  }

  return c.json({
    profile: publicProfile(row, { self: viewer?.id === row.userId }),
    viewerFollows,
    followsViewer,
  });
});

people.get("/profiles/:username/posts", async (c) => {
  const db = c.get("db");
  const username = c.req.param("username");
  const row = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${username.toLowerCase()}`,
  });
  if (!row) throw apiError(404, "not_found", "No such painter.");

  const page = await getProfilePosts(
    db,
    row.userId,
    c.get("user")?.id ?? null,
    c.req.query("cursor"),
  );
  return c.json(page);
});

people.post("/profiles/:username/follow", requireAuth, async (c) => {
  await rateLimit(c, "follow", { max: 60, windowSeconds: 300 });
  return c.json(await toggleFollow(c, true));
});

people.delete("/profiles/:username/follow", requireAuth, async (c) => {
  return c.json(await toggleFollow(c, false));
});

async function toggleFollow(
  c: ApiContext,
  following: boolean,
) {
  const db = c.get("db");
  const viewer = c.get("user")!;
  const target = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username")!.toLowerCase()}`,
  });
  if (!target) throw apiError(404, "not_found", "No such painter.");
  if (target.status !== "active") {
    throw apiError(403, "forbidden", "That account is unavailable.");
  }
  return setFollow(db, viewer.id, target.userId, following);
}

people.get("/profiles/:username/followers", async (c) => {
  return c.json(await listGraph(c, "followers"));
});

people.get("/profiles/:username/following", async (c) => {
  return c.json(await listGraph(c, "following"));
});

async function listGraph(
  c: ApiContext,
  direction: "followers" | "following",
) {
  const db = c.get("db");
  const target = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username")!.toLowerCase()}`,
  });
  if (!target) throw apiError(404, "not_found", "No such painter.");

  const joinOn =
    direction === "followers"
      ? eq(profile.userId, follow.followerId)
      : eq(profile.userId, follow.followeeId);
  const filter =
    direction === "followers"
      ? eq(follow.followeeId, target.userId)
      : eq(follow.followerId, target.userId);

  const rows = await db
    .select({
      username: profile.username,
      displayName: profile.displayName,
      avatarImageId: profile.avatarImageId,
      bio: profile.bio,
    })
    .from(follow)
    .innerJoin(profile, joinOn)
    .where(filter)
    .orderBy(desc(follow.createdAt))
    .limit(100);

  return { people: rows };
}

/* -------------------------------------------------------------------------- */
/* Blocks, mutes, push tokens                                                 */
/* -------------------------------------------------------------------------- */

people.post("/profiles/:username/block", requireAuth, async (c) =>
  c.json(await toggleRelation(c, "block", true)),
);
people.delete("/profiles/:username/block", requireAuth, async (c) =>
  c.json(await toggleRelation(c, "block", false)),
);
people.post("/profiles/:username/mute", requireAuth, async (c) =>
  c.json(await toggleRelation(c, "mute", true)),
);
people.delete("/profiles/:username/mute", requireAuth, async (c) =>
  c.json(await toggleRelation(c, "mute", false)),
);

async function toggleRelation(
  c: ApiContext,
  kind: "block" | "mute",
  on: boolean,
) {
  const db = c.get("db");
  const viewer = c.get("user")!;
  const target = await db.query.profile.findFirst({
    where: sql`lower(${profile.username}) = ${c.req.param("username")!.toLowerCase()}`,
  });
  if (!target) throw apiError(404, "not_found", "No such painter.");

  return kind === "block"
    ? setBlock(db, viewer.id, target.userId, on)
    : setMute(db, viewer.id, target.userId, on);
}

/** Registered by the iOS app after the user accepts push permission. */
people.post("/push/tokens", requireAuth, async (c) => {
  const parsed = pushTokenSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("Invalid token payload.");

  const db = c.get("db");
  const user = c.get("user")!;
  const nowSeconds = Math.floor(Date.now() / 1000);

  await db
    .insert(pushToken)
    .values({
      id: newId("pt"),
      userId: user.id,
      platform: parsed.data.platform,
      token: parsed.data.token,
    })
    .onConflictDoUpdate({
      target: pushToken.token,
      set: { userId: user.id, lastSeenAt: nowSeconds },
    });

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */

/**
 * Strips everything private before a profile leaves the server. `birthdate`,
 * `statusReason` and the role are the ones that matter — they must never end
 * up in a feed payload.
 */
export function publicProfile(
  row: typeof profile.$inferSelect,
  options: { self?: boolean } = {},
) {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    avatarImageId: row.avatarImageId,
    bannerImageId: row.bannerImageId,
    location: row.location,
    websiteUrl: row.websiteUrl,
    pronouns: row.pronouns,
    systems: row.systems ?? [],
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    postCount: row.postCount,
    createdAt: row.createdAt,
    ...(options.self
      ? {
          role: row.role,
          status: row.status,
          statusReason: row.statusReason,
          hasBirthdate: Boolean(row.birthdate),
        }
      : {}),
  };
}
