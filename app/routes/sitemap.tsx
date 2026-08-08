import { and, desc, eq, isNull } from "drizzle-orm";
import type { Route } from "./+types/sitemap";
import { getScope } from "../lib/data.server";
import { post, profile } from "../../server/db/schema";
import { GAME_SYSTEMS } from "../lib/taxonomy";

/**
 * Organic search is the cheapest growth a site like this gets: "how to paint
 * Death Guard rust" is a real query with real volume, and every post here is a
 * potential answer. So public posts, profiles and system pages all go in.
 *
 * Capped at 5,000 posts. Beyond that this needs a sitemap index, which is the
 * right problem to have.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const base = scope.env.SITE_URL;

  const [posts, people] = await Promise.all([
    scope.db
      .select({ id: post.id, updatedAt: post.updatedAt })
      .from(post)
      .where(
        and(
          eq(post.status, "published"),
          eq(post.visibility, "public"),
          eq(post.sensitive, false),
          isNull(post.deletedAt),
        ),
      )
      .orderBy(desc(post.publishedAt))
      .limit(5000),
    scope.db
      .select({ username: profile.username, updatedAt: profile.updatedAt })
      .from(profile)
      .where(eq(profile.status, "active"))
      .orderBy(desc(profile.updatedAt))
      .limit(2000),
  ]);

  const entries: { loc: string; lastmod?: number; priority: string }[] = [
    { loc: base, priority: "1.0" },
    { loc: `${base}/explore`, priority: "0.9" },
    { loc: `${base}/about`, priority: "0.5" },
    { loc: `${base}/rules`, priority: "0.3" },
    { loc: `${base}/safety`, priority: "0.3" },
    { loc: `${base}/privacy`, priority: "0.2" },
    { loc: `${base}/terms`, priority: "0.2" },
    ...GAME_SYSTEMS.map((system) => ({
      loc: `${base}/systems/${system}`,
      priority: "0.7",
    })),
    ...posts.map((entry) => ({
      loc: `${base}/posts/${entry.id}`,
      lastmod: entry.updatedAt,
      priority: "0.8",
    })),
    ...people.map((person) => ({
      loc: `${base}/@${person.username}`,
      lastmod: person.updatedAt,
      priority: "0.6",
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) =>
      `  <url><loc>${escapeXml(entry.loc)}</loc>${
        entry.lastmod
          ? `<lastmod>${new Date(entry.lastmod * 1000).toISOString().slice(0, 10)}</lastmod>`
          : ""
      }<priority>${entry.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=1800",
    },
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
