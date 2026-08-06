import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { profile } from "../db/schema";

import { USERNAME_MAX, USERNAME_MIN } from "../../app/lib/taxonomy";

export { USERNAME_MAX, USERNAME_MIN };
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * Names we keep back so they can never be impersonated or collide with a route.
 * Routes matter because profiles live at the root: /@name is namespaced by the
 * '@', but these still show up in support tickets and emails.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "about",
  "auth",
  "help",
  "support",
  "moderator",
  "mod",
  "staff",
  "team",
  "official",
  "spruetube",
  "sprue",
  "loadeddice",
  "loaded_dice",
  "settings",
  "login",
  "logout",
  "signup",
  "register",
  "explore",
  "discover",
  "feed",
  "home",
  "search",
  "notifications",
  "messages",
  "legal",
  "privacy",
  "terms",
  "safety",
  "ads",
  "advertise",
  "null",
  "undefined",
  "root",
  "system",
  "me",
  "you",
]);

export type UsernameProblem =
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "reserved";

export function validateUsername(raw: string): UsernameProblem | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) return "too_short";
  if (name.length > USERNAME_MAX) return "too_long";
  if (!USERNAME_RE.test(name)) return "invalid_characters";
  if (RESERVED.has(name.toLowerCase())) return "reserved";
  return null;
}

export function usernameProblemMessage(problem: UsernameProblem): string {
  switch (problem) {
    case "too_short":
      return `Usernames need at least ${USERNAME_MIN} characters.`;
    case "too_long":
      return `Usernames can be at most ${USERNAME_MAX} characters.`;
    case "invalid_characters":
      return "Use letters, numbers and underscores only.";
    case "reserved":
      return "That username is reserved.";
  }
}

export async function isUsernameAvailable(
  db: Db,
  name: string,
  exceptUserId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: profile.userId })
    .from(profile)
    .where(sql`lower(${profile.username}) = ${name.toLowerCase()}`)
    .limit(1);
  const row = rows[0];
  if (!row) return true;
  return row.userId === exceptUserId;
}

/** A plausible starting username derived from whatever the provider gave us. */
export function suggestUsername(name?: string | null, email?: string | null) {
  const fromName = (name ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "");
  const fromEmail = (email ?? "").split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "");
  const base = (fromName || fromEmail || "painter").slice(0, USERNAME_MAX - 4);
  return base.length >= USERNAME_MIN ? base : `painter${base}`;
}

/**
 * Return `base`, or the first free `base2`, `base3`… variant.
 *
 * There is a race here: two signups could pass the availability check for the
 * same name in the same instant. The unique index on lower(username) is the
 * real guard — the caller sees a constraint error and retries. This just keeps
 * that path rare.
 */
export async function reserveUsername(db: Db, base: string): Promise<string> {
  const cleaned = base.replace(/[^a-zA-Z0-9_]/g, "") || "painter";
  const seed = cleaned.slice(0, USERNAME_MAX);

  if (!RESERVED.has(seed.toLowerCase()) && (await isUsernameAvailable(db, seed)))
    return seed;

  for (let i = 2; i < 100; i++) {
    const suffix = String(i);
    const candidate = seed.slice(0, USERNAME_MAX - suffix.length) + suffix;
    if (await isUsernameAvailable(db, candidate)) return candidate;
  }

  // Fall back to something that is not going to collide.
  return `painter${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
