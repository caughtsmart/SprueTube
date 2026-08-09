import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/market";
import { ListingCard, MarketSafetyNote } from "../components/ListingCard";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import {
  filtersToQuery,
  listListings,
  parseListingFilters,
  type ListingPage,
  type ListingSummary,
} from "../../server/services/market";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  LISTING_CONDITIONS,
  LISTING_CONDITION_LABELS,
  LISTING_KINDS,
  LISTING_KIND_LABELS,
} from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Buy and sell — SprueTube" },
    {
      name: "description",
      content:
        "Second-hand miniatures, kits and paint, plus wanted posts, from the SprueTube community. Listings and contact only — no payments pass through SprueTube.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const url = new URL(request.url);

  const filters = parseListingFilters({
    kind: url.searchParams.get("kind"),
    system: url.searchParams.get("system"),
    condition: url.searchParams.get("condition"),
  });

  const [page, mine] = await Promise.all([
    listListings(scope.db, {
      viewerId: scope.viewer?.userId ?? null,
      filters,
    }),
    // The seller's own board, sold and withdrawn included — those are off the
    // public list the moment they close, and their owner still needs them.
    scope.viewer
      ? listListings(scope.db, {
          viewerId: scope.viewer.userId,
          sellerId: scope.viewer.userId,
          includeClosed: true,
          limit: 12,
        })
      : Promise.resolve<ListingPage>({ listings: [], nextCursor: null }),
  ]);

  return {
    filters,
    query: filtersToQuery(filters),
    listings: page.listings,
    nextCursor: page.nextCursor,
    mine: mine.listings,
    signedIn: Boolean(scope.viewer),
  };
}

export default function Market({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const { filters } = loaderData;

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Buy and sell</h1>
          <p className="st-text-muted mt-1 text-sm">
            Kit, paint and painted models, and posts from people looking for
            something.
          </p>
        </div>
        <Link to="/market/new" className="st-btn st-btn-primary text-sm">
          Post a listing
        </Link>
      </header>

      <MarketSafetyNote />

      {/* Kind first, and always visible: it is the one filter that changes what
          the page means rather than just how much of it there is. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <KindTab
          label="Everything"
          active={!filters.kind}
          onClick={() => setFilter("kind", "")}
        />
        {LISTING_KINDS.map((kind) => (
          <KindTab
            key={kind}
            label={LISTING_KIND_LABELS[kind]}
            active={filters.kind === kind}
            onClick={() => setFilter("kind", kind)}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="sr-only">Game or subject</span>
          <select
            value={filters.gameSystem ?? ""}
            onChange={(event) => setFilter("system", event.target.value)}
            className="st-input w-auto py-1.5 text-sm"
          >
            <option value="">Any system</option>
            {GAME_SYSTEMS.map((system) => (
              <option key={system} value={system}>
                {GAME_SYSTEM_LABELS[system]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="sr-only">Condition</span>
          <select
            value={filters.condition ?? ""}
            onChange={(event) => setFilter("condition", event.target.value)}
            className="st-input w-auto py-1.5 text-sm"
          >
            <option value="">Any condition</option>
            {LISTING_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {LISTING_CONDITION_LABELS[condition]}
              </option>
            ))}
          </select>
        </label>

        {filters.kind || filters.gameSystem || filters.condition ? (
          <Link to="/market" className="st-btn st-btn-ghost py-1.5 text-sm">
            Clear
          </Link>
        ) : null}
      </div>

      <p className="st-text-muted mt-3 text-xs">Most recently bumped first.</p>

      <ListingGrid
        initialListings={loaderData.listings}
        initialCursor={loaderData.nextCursor}
        endpoint={`/listings${loaderData.query ? `?${loaderData.query}` : ""}`}
      />

      {loaderData.mine.length ? (
        <section className="mt-10" aria-label="Your listings">
          <h2 className="mb-3 text-base font-semibold">Your listings</h2>
          <ul className="st-card divide-y divide-[var(--line-soft)]">
            {loaderData.mine.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/market/${entry.seller.username}/${entry.slug}`}
                    className="st-text-strong line-clamp-1 text-sm font-medium hover:underline"
                  >
                    {entry.title}
                  </Link>
                  <p className="st-text-muted text-xs">
                    {LISTING_KIND_LABELS[entry.kind]}
                    {entry.priceLabel ? ` · ${entry.priceLabel}` : ""}
                  </p>
                </div>
                <span className="st-chip shrink-0">
                  {entry.status === "open"
                    ? "Live"
                    : entry.status === "sold"
                      ? "Sold"
                      : "Withdrawn"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function KindTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "st-btn py-1.5 text-sm",
        active ? "st-btn-primary" : "st-btn-ghost",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * The list itself, with a "load more" button rather than infinite scroll.
 *
 * Browsing classifieds is a deliberate activity — people scan, go back, and
 * compare — and an endlessly growing page makes the back button useless.
 */
function ListingGrid({
  initialListings,
  initialCursor,
  endpoint,
}: {
  initialListings: ListingSummary[];
  initialCursor: string | null;
  endpoint: string;
}) {
  const [listings, setListings] = useState(initialListings);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A filter change is a different list, not more of this one.
  useEffect(() => {
    setListings(initialListings);
    setCursor(initialCursor);
    setError(null);
  }, [endpoint, initialListings, initialCursor]);

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    setError(null);

    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const page = await api.get<ListingPage>(
        `${endpoint}${separator}cursor=${encodeURIComponent(cursor)}`,
      );
      setListings((current) => {
        // Anyone can bump mid-scroll, so a listing from page one can turn up
        // again on page two. Dedupe rather than render it twice.
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.listings.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError("Could not load more. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (!listings.length) {
    return (
      <div className="st-card mt-4 p-10 text-center">
        <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
        <h2 className="mt-4 text-lg font-semibold">Nothing listed here</h2>
        <p className="st-text-muted mt-2 text-sm">
          Try a wider filter, or post the thing you are looking for as a wanted
          ad.
        </p>
        <Link to="/market/new" className="st-btn st-btn-ghost mt-4">
          Post a listing
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {listings.map((entry) => (
          <li key={entry.id}>
            <ListingCard listing={entry} />
          </li>
        ))}
      </ul>

      {error ? <p className="st-error mt-4 text-center">{error}</p> : null}

      {cursor ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="st-btn st-btn-ghost"
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : (
        <p className="st-text-muted py-8 text-center text-sm">
          That is everything for now.
        </p>
      )}
    </>
  );
}
