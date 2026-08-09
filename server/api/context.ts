import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAuth } from "../auth";
import { createDb, type Db } from "../db/client";
import type { Profile } from "../db/schema";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

export type ApiEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    /** null for anonymous requests. */
    user: SessionUser | null;
    /** Always present when `user` is — created by the auth signup hook. */
    profile: Profile | null;
  };
};

export type ApiContext = Context<ApiEnv>;

/** Attaches the D1 handle. Runs on every request, including anonymous ones. */
export const withDb: MiddlewareHandler<ApiEnv> = async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
};

/**
 * Resolves the session if there is one. Never rejects — public endpoints still
 * want to know who is asking so they can mark posts as liked or hide blocks.
 */
export const withSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  c.set("user", null);
  c.set("profile", null);

  try {
    const auth = getAuth(c.env);
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (result?.user) {
      c.set("user", {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        emailVerified: Boolean(result.user.emailVerified),
      });
      const db = c.get("db");
      const row = await db.query.profile.findFirst({
        where: (p, { eq }) => eq(p.userId, result.user.id),
      });
      c.set("profile", row ?? null);
    }
  } catch {
    // A malformed or expired cookie is an anonymous request, not a 500.
  }

  await next();
};

export const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw unauthorized();

  const profile = c.get("profile");
  if (profile?.status === "suspended") {
    throw new HTTPException(403, {
      res: json(
        {
          error: "account_suspended",
          message:
            profile.statusReason ??
            "Your account is suspended. You can appeal at spruetube.app/contact.",
        },
        403,
      ),
    });
  }

  await next();
};

export const requireModerator: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const profile = c.get("profile");
  if (!profile) throw unauthorized();
  if (profile.role !== "moderator" && profile.role !== "admin") {
    throw new HTTPException(403, {
      res: json({ error: "forbidden", message: "Moderators only." }, 403),
    });
  }
  await next();
};

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function apiError(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503,
  error: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return new HTTPException(status, {
    res: json({ error, message, ...extra }, status),
  });
}

export const unauthorized = () =>
  apiError(401, "unauthorized", "Sign in to do that.");
export const notFound = (what = "That") =>
  apiError(404, "not_found", `${what} could not be found.`);
export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  apiError(400, "bad_request", message, extra);

/**
 * Turns a Zod failure into one flat `{ field: message }` map. The forms are
 * plain HTML forms, so they need field-level errors, not an issue tree.
 */
export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Fixed-window counter in KV, and it is weaker than a counter sounds.
 *
 * Read, compare, write is not atomic, and KV is eventually consistent on top of
 * that: two requests that read before either writes both see the same number
 * and both proceed. So a burst fired in parallel is not slowed to the limit
 * plus a little — it passes almost entirely, because every request in it reads
 * a count from before the burst started. What this stops is a client looping
 * sequentially, which is what a runaway retry or a careless script actually
 * looks like. It does not stop anyone who opens fifty sockets at once.
 *
 * A real fix needs a single serialisation point per subject, which on Workers
 * means a Durable Object keyed by `action:subject` holding the count and
 * deciding in its own single-threaded execution — or Cloudflare's own rate
 * limiting binding. Either is a bigger change than this file, and until then
 * WAF rules are the load-bearing defence against a motivated attacker.
 */
export async function rateLimit(
  c: ApiContext,
  action: string,
  { max, windowSeconds }: { max: number; windowSeconds: number },
) {
  const user = c.get("user");
  const subject =
    user?.id ?? c.req.header("cf-connecting-ip") ?? "anonymous";
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${action}:${subject}:${bucket}`;

  const current = Number((await c.env.CACHE.get(key)) ?? 0);
  if (current >= max) {
    throw apiError(
      429,
      "rate_limited",
      "You are doing that too quickly. Give it a minute.",
    );
  }
  await c.env.CACHE.put(key, String(current + 1), {
    expirationTtl: Math.max(60, windowSeconds * 2),
  });
}
