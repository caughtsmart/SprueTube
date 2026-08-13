import { and, desc, eq, isNull } from "drizzle-orm";
import type { Route } from "./+types/sitemap";
import { getScope } from "../lib/data.server";
import {
  commission,
  listing,
  post,
  profile,
  project,
  recipe,
} from "../../server/db/schema";
import { recentNewsSlugs } from "../../server/services/news";
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

  const [posts, people, buildLogs, recipes, news, listings, commissions] =
    await Promise.all([
    /*
     * The join is the point, not decoration. Every other query below already
     * filters on the author's account being active; this one did not, so posts
     * by suspended and deleted accounts carried on being handed to search
     * engines long after the site stopped showing them — the one place that
     * outlives the suspension.
     */
    scope.db
      .select({ id: post.id, updatedAt: post.updatedAt })
      .from(post)
      .innerJoin(profile, eq(profile.userId, post.authorId))
      .where(
        and(
          eq(post.status, "published"),
          eq(post.visibility, "public"),
          eq(post.sensitive, false),
          isNull(post.deletedAt),
          eq(profile.status, "active"),
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
    /*
     * Build logs are the pages most worth finding from a search engine — "Death
     * Guard army blog" is a search someone actually makes, and a whole log
     * answers it better than any single post in it.
     */
    scope.db
      .select({
        slug: project.slug,
        updatedAt: project.updatedAt,
        username: profile.username,
      })
      .from(project)
      .innerJoin(profile, eq(profile.userId, project.ownerId))
      .where(eq(profile.status, "active"))
      .orderBy(desc(project.updatedAt))
      .limit(2000),
    // Public recipes only — "how to paint Death Guard rust" is the query these
    // answer, and unlisted/private ones are deliberately not for search.
    scope.db
      .select({
        slug: recipe.slug,
        updatedAt: recipe.updatedAt,
        username: profile.username,
      })
      .from(recipe)
      .innerJoin(profile, eq(profile.userId, recipe.ownerId))
      .where(and(eq(recipe.visibility, "public"), eq(profile.status, "active")))
      .orderBy(desc(recipe.updatedAt))
      .limit(2000),
    recentNewsSlugs(scope.db, 200),
    // Only open listings: a sold item indexed for a year is a bad result for
    // the searcher and a nuisance for the seller who keeps being asked about it.
    scope.db
      .select({
        slug: listing.slug,
        updatedAt: listing.updatedAt,
        username: profile.username,
      })
      .from(listing)
      .innerJoin(profile, eq(profile.userId, listing.sellerId))
      .where(and(eq(listing.status, "open"), eq(profile.status, "active")))
      .orderBy(desc(listing.bumpedAt))
      .limit(2000),
    scope.db
      .select({
        slug: commission.slug,
        updatedAt: commission.updatedAt,
        username: profile.username,
      })
      .from(commission)
      .innerJoin(profile, eq(profile.userId, commission.ownerId))
      .where(and(eq(commission.status, "active"), eq(profile.status, "active")))
      .orderBy(desc(commission.updatedAt))
      .limit(1000),
  ]);

  const entries: { loc: string; lastmod?: number; priority: string }[] = [
    { loc: base, priority: "1.0" },
    { loc: `${base}/explore`, priority: "0.9" },
    { loc: `${base}/news`, priority: "0.8" },
    { loc: `${base}/market`, priority: "0.7" },
    { loc: `${base}/commissions`, priority: "0.7" },
    { loc: `${base}/about`, priority: "0.5" },
    { loc: `${base}/rules`, priority: "0.3" },
    { loc: `${base}/safety`, priority: "0.3" },
    { loc: `${base}/privacy`, priority: "0.2" },
    { loc: `${base}/terms`, priority: "0.2" },
    { loc: `${base}/contact`, priority: "0.3" },
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
    ...buildLogs.map((entry) => ({
      loc: `${base}/@${entry.username}/projects/${entry.slug}`,
      lastmod: entry.updatedAt,
      priority: "0.8",
    })),
    ...recipes.map((entry) => ({
      loc: `${base}/@${entry.username}/recipes/${entry.slug}`,
      lastmod: entry.updatedAt,
      priority: "0.7",
    })),
    ...news.map((entry) => ({
      loc: `${base}/news/${entry.slug}`,
      lastmod: entry.publishedAt,
      priority: "0.5",
    })),
    ...listings.map((entry) => ({
      loc: `${base}/market/${entry.username}/${entry.slug}`,
      lastmod: entry.updatedAt,
      priority: "0.5",
    })),
    ...commissions.map((entry) => ({
      loc: `${base}/commissions/${entry.username}/${entry.slug}`,
      lastmod: entry.updatedAt,
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
