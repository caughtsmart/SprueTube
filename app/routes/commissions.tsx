import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/commissions";
import { CommissionCard, type CommissionSummary } from "../components/CommissionCard";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { useRoot } from "../root";
import { browseCommissions } from "../../server/services/commissions";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Commission painting — SprueTube" },
    {
      name: "description",
      content:
        "Painters taking commission work: prices, turnaround and the systems they paint. Arrange it between yourselves.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const url = new URL(request.url);

  const system = url.searchParams.get("system");
  const openOnly = url.searchParams.get("open") === "1";

  const page = await browseCommissions(scope.db, {
    viewerId: scope.viewer?.userId ?? null,
    gameSystem: system,
    openOnly,
  });

  return {
    commissions: page.commissions,
    nextCursor: page.nextCursor,
    system,
    openOnly,
  };
}

export default function Commissions({ loaderData }: Route.ComponentProps) {
  const { config, viewer } = useRoot();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<CommissionSummary[]>(
    loaderData.commissions,
  );
  const [cursor, setCursor] = useState(loaderData.nextCursor);
  const [loading, setLoading] = useState(false);

  // A filter change is a different list, not more of the same one.
  useEffect(() => {
    setItems(loaderData.commissions);
    setCursor(loaderData.nextCursor);
  }, [loaderData.commissions, loaderData.nextCursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ cursor });
      if (loaderData.system) query.set("system", loaderData.system);
      if (loaderData.openOnly) query.set("open", "1");

      const page = await api.get<{
        commissions: CommissionSummary[];
        nextCursor: string | null;
      }>(`/commissions?${query.toString()}`);

      setItems((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.commissions.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Leave the list as it stands; the button below stays available.
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, loaderData.openOnly, loaderData.system]);

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Commission painting</h1>
          <p className="st-text-muted mt-1 text-sm">
            Painters taking work, open books first.
          </p>
        </div>

        {viewer ? (
          <Link to="/commissions/new" className="st-btn st-btn-primary text-sm">
            List your service
          </Link>
        ) : null}
      </header>

      {/*
        Said once, plainly, at the top. People are about to arrange money with a
        stranger and they should know exactly where SprueTube stands before they
        do — which is nowhere near it.
      */}
      <p className="st-card st-text-muted mt-4 p-3 text-sm leading-relaxed">
        SprueTube does not handle payments and does not vet painters. Anything
        you agree here is between you and them, so take the usual care you would
        with anyone you have not met.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={loaderData.system ?? ""}
          onChange={(event) => setFilter("system", event.target.value || null)}
          aria-label="Filter by game system"
          className="st-input w-auto text-sm"
        >
          <option value="">Every system</option>
          {GAME_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {GAME_SYSTEM_LABELS[system]}
            </option>
          ))}
        </select>

        <label className="st-text-muted flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={loaderData.openOnly}
            onChange={(event) =>
              setFilter("open", event.target.checked ? "1" : null)
            }
            className="accent-[var(--color-primer-500)]"
          />
          Open to work only
        </label>
      </div>

      {items.length ? (
        <div className="mt-4 flex flex-col gap-4">
          {items.map((row) => (
            <CommissionCard key={row.id} commission={row} config={config} />
          ))}
        </div>
      ) : (
        <div className="st-card mt-4 p-10 text-center">
          <p className="text-4xl">🖌</p>
          <h2 className="mt-4 text-lg font-semibold">Nobody here yet</h2>
          <p className="st-text-muted mt-2 text-sm">
            {loaderData.system || loaderData.openOnly
              ? "Try widening the filters."
              : "Be the first to put your brush up for hire."}
          </p>
        </div>
      )}

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
      ) : null}
    </div>
  );
}
