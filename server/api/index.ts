import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getAuth } from "../auth";
import { withDb, withSession, type ApiEnv } from "./context";
import { content } from "./routes/content";
import { media } from "./routes/media";
import { people } from "./routes/people";
import { promos } from "./routes/promos";
import { safety } from "./routes/safety";

/*
 * The whole HTTP API. Mounted at /api by workers/app.ts, which passes anything
 * that is not an /api path to the React Router SSR handler.
 *
 * Versioned at /api/v1 from the start. The iOS app will be shipped, installed
 * and out of our control, so old clients have to keep working while the web app
 * moves on — that is only possible if there is a version in the path.
 */
// basePath, not a mount: workers/app.ts hands over the untouched request, so
// every route below is matched against the full "/api/..." path.
export const api = new Hono<ApiEnv>().basePath("/api");

api.use("*", secureHeaders());

/*
 * The web app is same-origin, so it does not need CORS at all. The native app
 * does: it sends `Origin: null` or a capacitor/file origin. Reflecting an
 * explicit allowlist rather than '*' keeps credentialed requests working.
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
