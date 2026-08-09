import { useState } from "react";
import { Link, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/news";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { timeAgo } from "../lib/format";
import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  type NewsCategory,
} from "../lib/taxonomy";
import { listNews, type NewsListItem } from "../../server/services/news";

/*
 * The daily brief.
 *
 * Every row is somebody else's reporting, so every row names them and links to
 * them. No images anywhere on these pages: the photographs in a hobby news post
 * belong to the publisher, and hotlinking them would be both a bandwidth
 * imposition and a copyright argument nobody needs.
 */

export function meta() {
  return [
    { title: "Hobby news — SprueTube" },
    {
      name: "description",
      content:
        "A short daily brief of miniature and modelling news — half Warhammer, half the wider hobby. Every item links straight to the publication that wrote it.",
    },
  ];
}

function readCategory(request: Request): NewsCategory | null {
  const value = new URL(request.url).searchParams.get("category");
  return NEWS_CATEGORIES.includes(value as NewsCategory)
    ? (value as NewsCategory)
    : null;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const isAdmin = scope.viewer?.profile.role === "admin";

  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before"));
  const category = readCategory(request);

  const page = await listNews(scope.db, {
    category,
    before: Number.isFinite(before) && before > 0 ? before : null,
    // The id half of the cursor. Without it a page boundary that lands on a run
    // of items sharing one timestamp drops the rest of that run.
    beforeId: url.searchParams.get("beforeId"),
    limit: 30,
    // Admins see hidden rows so they can put one back; everyone else sees the
    // page as it is meant to read.
    includeHidden: isAdmin,
  });

  const older =
    page.nextCursor && page.nextCursorId
      ? `/news?${new URLSearchParams({
          ...(category ? { category } : {}),
          before: String(page.nextCursor),
          beforeId: page.nextCursorId,
        })}`
      : null;

  return { items: page.items, isAdmin, older };
}

const FILTERS: { label: string; value: NewsCategory | null }[] = [
  { label: "Everything", value: null },
  ...NEWS_CATEGORIES.map((category) => ({
    label: NEWS_CATEGORY_LABELS[category],
    value: category,
  })),
];

export default function News({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const active = searchParams.get("category");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-bold">Hobby news</h1>
      <p className="st-text-muted mt-1 text-sm">
        A short brief, updated each morning. Half Warhammer, half everything
        else. Nothing here is ours — every line is a summary of somebody else's
        article, and the link goes straight to them.
      </p>

      {loaderData.isAdmin ? <FetchNow /> : null}

      <nav
        className="st-border mt-4 flex gap-1 border-b pb-2"
        aria-label="Filter news"
      >
        {FILTERS.map((filter) => {
          const current = active === filter.value;
          return (
            <Link
              key={filter.label}
              to={filter.value ? `/news?category=${filter.value}` : "/news"}
              className={[
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                current
                  ? "st-raised st-text-strong"
                  : "st-text-muted hover:st-text-strong",
              ].join(" ")}
              aria-current={current ? "page" : undefined}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {loaderData.items.length ? (
        <ul className="mt-5 flex flex-col gap-3">
          {loaderData.items.map((item) => (
            <NewsRow key={item.id} item={item} isAdmin={loaderData.isAdmin} />
          ))}
        </ul>
      ) : (
        <div className="st-card mt-5 p-10 text-center">
          <h2 className="text-lg font-semibold">Nothing yet</h2>
          <p className="st-text-muted mx-auto mt-2 max-w-sm text-sm">
            The brief is put together once a day from a fixed list of hobby
            publications. If none of them could be reached, we publish nothing
            rather than guess.
          </p>
        </div>
      )}

      {loaderData.older ? (
        <div className="mt-5 text-center">
          <Link to={loaderData.older} className="st-btn st-btn-ghost">
            Older items
          </Link>
        </div>
      ) : null}

      <p className="st-text-muted mt-6 text-xs">
        Headlines and summaries remain the property of the publications named.
        SprueTube does not reproduce their photographs.
      </p>
    </div>
  );
}

function NewsRow({
  item,
  isAdmin,
}: {
  item: NewsListItem;
  isAdmin: boolean;
}) {
  return (
    <li
      className={`st-card p-4 ${item.status === "hidden" ? "opacity-50" : ""}`}
    >
      <div className="st-text-muted flex flex-wrap items-center gap-2 text-xs">
        <span className="st-chip">{NEWS_CATEGORY_LABELS[item.category]}</span>
        <span className="st-text-strong font-medium">{item.sourceName}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>
          {timeAgo(item.publishedAt)}
        </time>
        {item.status === "hidden" ? <span>· hidden</span> : null}
      </div>

      <h2 className="mt-2 text-base font-semibold">
        <Link to={`/news/${item.slug}`} className="hover:underline">
          {item.title}
        </Link>
      </h2>

      {item.summary !== item.title ? (
        <p className="st-text-muted mt-1 text-sm leading-relaxed">
          {item.summary}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener nofollow"
          className="st-link font-medium"
        >
          Read it at {item.sourceName} ↗
        </a>
        {isAdmin ? <HideButton item={item} /> : null}
      </div>
    </li>
  );
}

/** Admin-only. There is no editing — an item is either quoted as-is or hidden. */
function HideButton({ item }: { item: NewsListItem }) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const hidden = item.status === "hidden";

  async function toggle() {
    setBusy(true);
    try {
      await api.patch(`/news/${item.id}`, {
        status: hidden ? "published" : "hidden",
      });
      revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="st-text-muted hover:underline disabled:opacity-50"
    >
      {hidden ? "Show again" : "Hide"}
    </button>
  );
}

/**
 * Run the daily ingest early.
 *
 * The brief builds itself at 06:00 UTC, which is right for readers and useless
 * when you have just deployed and want to see whether the thing works. Admin
 * only, and rate limited server-side to four an hour — every run is a dozen
 * outbound fetches to other people's servers, and hammering them is how a
 * useful aggregator becomes a blocked one.
 *
 * Nothing is duplicated by pressing it twice: items are deduplicated on the
 * source URL, so a second run inserts only what is genuinely new.
 */
function FetchNow() {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await api.post<{
        inserted: number;
        split: Record<string, number>;
        failures: { source: string; reason: string }[];
      }>("/news/refresh");

      const parts = [
        `${outcome.inserted} added`,
        `${outcome.split.warhammer ?? 0} Warhammer, ${outcome.split.wider ?? 0} wider`,
      ];
      // Name the count rather than the sources: one publisher being down is
      // ordinary, and a wall of error text makes it look like a fault here.
      if (outcome.failures.length) {
        parts.push(
          `${outcome.failures.length} ${
            outcome.failures.length === 1 ? "source" : "sources"
          } unreachable`,
        );
      }
      setResult(parts.join(" · "));
      void revalidator.revalidate();
    } catch {
      setResult("Could not run the ingest. Check the Worker logs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-card mt-4 flex flex-wrap items-center gap-3 p-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="st-btn st-btn-ghost text-sm"
      >
        {busy ? "Fetching…" : "Fetch now"}
      </button>
      <p className="st-text-muted text-xs">
        {result ?? "Admin only. The brief builds itself at 06:00 UTC."}
      </p>
    </div>
  );
}
