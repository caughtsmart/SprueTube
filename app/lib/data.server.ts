/*
 * The bridge between route modules and the server.
 *
 * Loaders call the service layer directly rather than fetching our own HTTP
 * API — the API lives in the same Worker, so a self-fetch would mean a second
 * request, a second session lookup and a second set of D1 round trips for no
 * benefit. The HTTP API still exists and is still the contract; it is what the
 * browser calls for likes, infinite scroll and uploads, and what the iOS app
 * will call for everything.
 *
 * Everything here is `.server.ts`, so none of it can leak into the client
 * bundle no matter how a route module imports it.
 */

import type { RouterContextProvider } from "react-router";
import { cloudflare } from "../context";
import { getAuth } from "../../server/auth";
import { createDb, type Db } from "../../server/db/client";
import type { Profile } from "../../server/db/schema";
import { imageUrl } from "../../server/services/media";

export type Viewer = {
  userId: string;
  profile: Profile;
} | null;

export type RequestScope = {
  env: Env;
  ctx: ExecutionContext;
  db: Db;
  viewer: Viewer;
};

export function getEnv(context: Readonly<RouterContextProvider>): Env {
  return context.get(cloudflare).env;
}

/**
 * Everything a loader needs, resolved once. Call this at the top of a loader
 * and pass the result down rather than re-resolving the session per helper.
 */
export async function getScope(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<RequestScope> {
  const { env, ctx } = context.get(cloudflare);
  const db = createDb(env.DB);

  let viewer: Viewer = null;
  try {
    const session = await getAuth(env).api.getSession({
      headers: request.headers,
    });
    if (session?.user) {
      const profile = await db.query.profile.findFirst({
        where: (p, { eq }) => eq(p.userId, session.user.id),
      });
      if (profile) viewer = { userId: session.user.id, profile };
    }
  } catch {
    // Treat a broken session as signed out rather than failing the page.
  }

  return { env, ctx, db, viewer };
}

/** Public shape of the signed-in user, safe to serialise into the page. */
export function viewerPayload(scope: RequestScope) {
  if (!scope.viewer) return null;
  const { profile } = scope.viewer;
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: imageUrl(scope.env, profile.avatarImageId, "avatar"),
    role: profile.role,
    needsOnboarding: !profile.birthdate,
    isModerator: profile.role === "moderator" || profile.role === "admin",
  };
}

export type ViewerPayload = ReturnType<typeof viewerPayload>;

export type PublicConfig = {
  siteName: string;
  siteUrl: string;
  shopName: string;
  shopUrl: string;
  adsenseClient: string | null;
  imagesAccountHash: string;
};

/**
 * Config the browser needs. Never put a secret in here.
 *
 * The return type is written out rather than inferred because `wrangler types`
 * gives every var in wrangler.jsonc a literal type — inferring would make
 * `siteName` the type `"SprueTube"` rather than `string`, and every fallback
 * elsewhere would stop compiling.
 */
export function publicConfig(env: Env): PublicConfig {
  return {
    siteName: env.SITE_NAME,
    siteUrl: env.SITE_URL,
    shopName: env.SHOP_NAME,
    shopUrl: env.SHOP_URL,
    adsenseClient: env.ADSENSE_CLIENT || null,
    imagesAccountHash: env.CF_IMAGES_ACCOUNT_HASH,
  };
}

