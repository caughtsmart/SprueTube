import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  apiError,
  badRequest,
  fieldErrors,
  notFound,
  rateLimit,
  requireAuth,
  unauthorized,
  type ApiEnv,
} from "../context";
import { NEWS_CATEGORIES } from "../../../app/lib/taxonomy";
import {
  getNewsBySlug,
  ingestNews,
  listNews,
  NEWS_SOURCES,
  setNewsStatus,
} from "../../services/news";

/*
 * The news brief.
 *
 * Read endpoints are public and anonymous — this is aggregated, attributed
 * content, and there is nothing here that belongs to a user. The only writes
 * are an admin hiding an item and an admin asking for an early ingest; there is
 * deliberately no endpoint that creates a news item from a request body, since
 * that would be a way to publish "news" with no source behind it.
 */
export const news = new Hono<ApiEnv>();

const categorySchema = z.enum(NEWS_CATEGORIES);

/** Hiding an item is an editorial decision, so it sits with admins, not mods. */
const requireAdmin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const profile = c.get("profile");
  if (!profile) throw unauthorized();
  if (profile.role !== "admin") {
    throw apiError(403, "forbidden", "Admins only.");
  }
  await next();
};

news.get("/news", async (c) => {
  const requested = c.req.query("category");
  const parsedCategory = categorySchema.safeParse(requested);
  if (requested && !parsedCategory.success) {
    throw badRequest("Unknown news category.");
  }

  const before = Number(c.req.query("before"));
  // Only an admin has any use for hidden rows, and only so they can put one back.
  const includeHidden =
    c.req.query("includeHidden") === "1" && c.get("profile")?.role === "admin";

  const page = await listNews(c.get("db"), {
    category: parsedCategory.success ? parsedCategory.data : null,
    before: Number.isFinite(before) && before > 0 ? before : null,
    limit: Number(c.req.query("limit")) || undefined,
    includeHidden,
  });

  return c.json(page);
});

/** The list of feeds we read, published so the aggregation is not a black box. */
news.get("/news/sources", (c) =>
  c.json({
    sources: NEWS_SOURCES.map(({ name, feedUrl, category }) => ({
      name,
      feedUrl,
      category,
    })),
  }),
);

news.get("/news/:slug", async (c) => {
  const item = await getNewsBySlug(c.get("db"), c.req.param("slug"), {
    includeHidden: c.get("profile")?.role === "admin",
  });
  if (!item) throw notFound("That news item");
  return c.json({ item });
});

const statusSchema = z.object({ status: z.enum(["published", "hidden"]) });

news.patch("/news/:id", requireAuth, requireAdmin, async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest("Status must be published or hidden.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const item = await setNewsStatus(
    c.get("db"),
    c.req.param("id"),
    parsed.data.status,
  );
  if (!item) throw notFound("That news item");

  return c.json({ item });
});

/**
 * Runs the ingest now rather than waiting for the morning cron.
 *
 * Useful on the day a source is added, and harmless to repeat: the unique index
 * on `source_url` means a second run inside the same hour inserts nothing. Rate
 * limited anyway, because each call is a dozen outbound fetches.
 */
news.post("/news/refresh", requireAuth, requireAdmin, async (c) => {
  await rateLimit(c, "news-refresh", { max: 4, windowSeconds: 3600 });
  return c.json(await ingestNews(c.env, { db: c.get("db") }));
});
