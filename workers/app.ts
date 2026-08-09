import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflare } from "../app/context";
import { api } from "../server/api";
import { refreshHotScores } from "../server/services/maintenance";
import { ingestNews, shouldRunDailyIngest } from "../server/services/news";

/*
 * One Worker serves both halves of SprueTube:
 *
 *   /api/*  → the Hono API, which the web app and the future iOS app share
 *   /*      → server-rendered React Router pages
 *
 * Keeping them together means one deploy, one set of bindings, and no
 * cross-origin cookie problems between the site and its own API. If the API
 * ever needs to scale or deploy separately, `server/api` is already a
 * self-contained Hono app — it lifts out into its own Worker unchanged.
 */

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(cloudflare, { env, ctx });

    return requestHandler(request, context);
  },

  /*
   * Discover ranks by a score that decays with age, so a post nobody touches
   * still has to fall down the page over time. Nothing writes to that score
   * unless the post gets engagement, hence this sweep. It also rescues videos
   * whose Stream webhook never arrived.
   */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshHotScores(env));
  },
} satisfies ExportedHandler<Env>;
