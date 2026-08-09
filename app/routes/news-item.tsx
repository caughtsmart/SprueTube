import { data, Link } from "react-router";
import type { Route } from "./+types/news-item";
import { getScope } from "../lib/data.server";
import { excerpt, fullDate } from "../lib/format";
import { NEWS_CATEGORY_LABELS } from "../lib/taxonomy";
import { getNewsBySlug, listNews } from "../../server/services/news";

/*
 * One item from the brief.
 *
 * This page exists to send people away from it. The summary is a few sentences
 * of somebody else's article and the link to the original is the largest thing
 * on the page — anything else would be passing off their reporting as ours.
 */

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.item) return [{ title: "News — SprueTube" }];

  const { item } = loaded;
  const description = excerpt(item.summary);

  return [
    { title: `${item.title} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: item.title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    { name: "twitter:card", content: "summary" },
    // The article itself lives elsewhere; point search engines at the original
    // rather than competing with the people who wrote it.
    { tagName: "link", rel: "canonical", href: item.sourceUrl },
    ...(item.status === "hidden" ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const isAdmin = scope.viewer?.profile.role === "admin";

  const item = await getNewsBySlug(scope.db, params.slug, {
    includeHidden: isAdmin,
  });
  if (!item) {
    throw data({ message: "That news item is not here." }, { status: 404 });
  }

  const page = await listNews(scope.db, { limit: 6 });

  return {
    item,
    more: page.items.filter((other) => other.id !== item.id).slice(0, 4),
  };
}

export default function NewsItem({ loaderData }: Route.ComponentProps) {
  const { item } = loaderData;

  return (
    <div className="mx-auto max-w-2xl py-2">
      <Link to="/news" className="st-text-muted text-xs hover:underline">
        ← Hobby news
      </Link>

      <div className="st-text-muted mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="st-chip">{NEWS_CATEGORY_LABELS[item.category]}</span>
        <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>
          {fullDate(item.publishedAt)}
        </time>
        {item.status === "hidden" ? <span>· hidden</span> : null}
      </div>

      <h1 className="mt-2 text-2xl font-bold">{item.title}</h1>

      <p className="st-text-muted mt-2 text-sm">
        Reported by{" "}
        <span className="st-text-strong font-medium">{item.sourceName}</span>.
        The lines below are the opening of their own piece, kept short on
        purpose — the article is theirs to publish, not ours.
      </p>

      <p className="mt-5 text-[0.9375rem] leading-relaxed">{item.summary}</p>

      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener nofollow"
        className="st-btn st-btn-primary mt-6 w-full sm:w-auto"
      >
        Read the full article at {item.sourceName} ↗
      </a>

      <p className="st-text-muted mt-3 text-xs break-words">{item.sourceUrl}</p>

      {loaderData.more.length ? (
        <section className="st-border mt-10 border-t pt-6">
          <h2 className="st-text-muted mb-3 text-xs font-semibold tracking-wide uppercase">
            Also in the brief
          </h2>
          <ul className="flex flex-col gap-2">
            {loaderData.more.map((other) => (
              <li key={other.id} className="text-sm">
                <Link to={`/news/${other.slug}`} className="hover:underline">
                  {other.title}
                </Link>
                <span className="st-text-muted"> — {other.sourceName}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
