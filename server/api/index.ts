import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getAuth } from "../auth";
import { withDb, withSession, type ApiEnv } from "./context";
import { commissions } from "./routes/commissions";
import { contact } from "./routes/contact";
import { content } from "./routes/content";
import { feedback } from "./routes/feedback";
import { market } from "./routes/market";
import { media } from "./routes/media";
import { messages } from "./routes/messages";
import { news } from "./routes/news";
import { people } from "./routes/people";
import { pins } from "./routes/pins";
import { projects } from "./routes/projects";
import { promos } from "./routes/promos";
import { push } from "./routes/push";
import { recipes } from "./routes/recipes";
import { safety } from "./routes/safety";

/*
 * The whole HTTP API. Mounted at /api by workers/app.ts, which passes anything
 * that is not an /api path to the React Router SSR handler.
 *
 * Versioned at /api/v1 from the start. It costs a path segment and it means a
 * future client — a native app, a bookmarklet, someone else's script — can keep
 * working while the web app moves on.
 */
// basePath, not a mount: workers/app.ts hands over the untouched request, so
// every route below is matched against the full "/api/..." path.
export const api = new Hono<ApiEnv>().basePath("/api");

api.use("*", secureHeaders());

/*
 * The web app is same-origin and needs no CORS at all. This exists so that a
 * request from anywhere else is refused by default rather than by accident —
 * an explicit allowlist, never '*', because these routes carry credentials.
 */
api.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = [c.env.SITE_URL, "https://www.spruetube.app"];
      if (!origin) return undefined;
      return allowed.includes(origin) ? origin : undefined;
    },
    credentials: true,
    allowHeaders: ["content-type", "authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

api.use("*", withDb);

/*
 * better-auth owns /api/auth/* entirely: sign-up, sign-in, OAuth callbacks,
 * password reset, sign-out. Mounted before withSession because it *is* the
 * thing that establishes the session.
 */
api.all("/auth/*", (c) => getAuth(c.env).handler(c.req.raw));

api.use("*", withSession);

api.get("/v1/health", (c) =>
  c.json({ ok: true, environment: c.env.ENVIRONMENT }),
);

api.route("/v1", people);
api.route("/v1", content);
api.route("/v1", media);
api.route("/v1", safety);
api.route("/v1", promos);
api.route("/v1", projects);
api.route("/v1", news);
api.route("/v1", commissions);
api.route("/v1", messages);
api.route("/v1", market);
api.route("/v1", contact);
api.route("/v1", feedback);
api.route("/v1", pins);
api.route("/v1", push);
api.route("/v1", recipes);

api.notFound((c) =>
  c.json({ error: "not_found", message: "No such endpoint." }, 404),
);

api.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  // Log the detail, return none of it. Stack traces and D1 errors have a habit
  // of naming columns and ids that should not leave the server.
  console.error("unhandled api error", {
    path: c.req.path,
    method: c.req.method,
    error: error instanceof Error ? error.stack ?? error.message : error,
  });

  return c.json(
    { error: "internal_error", message: "Something went wrong our end." },
    500,
  );
});
