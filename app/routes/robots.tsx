import type { Route } from "./+types/robots";
import { getEnv } from "../lib/data.server";

/**
 * Signed-in-only pages are excluded because a crawler can only ever see the
 * sign-in redirect, and repeatedly serving that to Googlebot looks like a soft
 * 404 farm. `/api/` is excluded for the same reason.
 */
export function loader({ context }: Route.LoaderArgs) {
  const env = getEnv(context);

  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /settings",
    "Disallow: /compose",
    "Disallow: /notifications",
    "Disallow: /saved",
    "Disallow: /moderation",
    "Disallow: /welcome",
    "Disallow: /login",
    "Disallow: /signup",
    "",
    `Sitemap: ${env.SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
