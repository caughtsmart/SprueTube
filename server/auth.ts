import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { createDb, schema } from "./db/client";
import { newId } from "./db/id";
import { reserveUsername, suggestUsername } from "./services/usernames";

export type Auth = ReturnType<typeof createAuth>;

/*
 * Workers hand us bindings per request, so the auth instance has to be built
 * from `env` rather than at module load. Building it is not free, and an
 * isolate serves many requests, so cache one instance per env object.
 */
const cache = new WeakMap<Env, Auth>();

export function getAuth(env: Env): Auth {
  let auth = cache.get(env);
  if (!auth) {
    auth = createAuth(env);
    cache.set(env, auth);
  }
  return auth;
}

function createAuth(env: Env) {
  const db = createDb(env.DB);

  const socialProviders: Record<string, unknown> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  // Apple is not optional once the iOS app ships: App Store guideline 4.8
  // requires Sign in with Apple alongside any other third-party login.
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    socialProviders.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    appName: "SprueTube",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.SITE_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Turn this on once transactional email is wired up (see docs/DEPLOY.md).
      requireEmailVerification: false,
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    advanced: {
      cookiePrefix: "spruetube",
      // The iOS app talks to the same origin over HTTPS; nothing here is
      // shared with loadeddice.uk, so no cross-domain cookie config.
      useSecureCookies: env.ENVIRONMENT === "production",
    },
    /*
     * better-auth rejects a sign-in whose Origin is not on this list, which is
     * what stops another site from driving our auth endpoints. Local dev runs
     * on a different origin to production, so it has to be named explicitly —
     * and only outside production, so a stray ENVIRONMENT value can never make
     * localhost a trusted origin on the live site.
     */
    trustedOrigins:
      env.ENVIRONMENT === "production"
        ? [env.SITE_URL, "https://www.spruetube.app"]
        : [env.SITE_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
    // Native clients cannot hold cookies as comfortably as a browser, so the
    // bearer plugin lets iOS send `Authorization: Bearer <token>` instead.
    plugins: [bearer()],
    databaseHooks: {
      user: {
        create: {
          /*
           * Every account needs a profile row, immediately. A social sign-in
           * gives us no username, so claim a provisional one now and let
           * onboarding rename it — that keeps "profile is always present" true
           * everywhere else in the codebase.
           */
          after: async (created) => {
            const existing = await db.query.profile.findFirst({
              where: (p, { eq }) => eq(p.userId, created.id),
            });
            if (existing) return;

            const username = await reserveUsername(
              db,
              suggestUsername(created.name, created.email),
            );
            await db.insert(schema.profile).values({
              userId: created.id,
              username,
              displayName: created.name?.trim() || username,
              avatarImageId: null,
            });
          },
        },
      },
    },
    user: {
      deleteUser: {
        // Cascades handle posts, comments, follows and media rows.
        enabled: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
    },
    logger: { level: env.ENVIRONMENT === "production" ? "error" : "info" },
  });
}

export { newId };
