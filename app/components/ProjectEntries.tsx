import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import type { ServedAd } from "../../server/services/ads";
import type { FeedPost } from "../../server/services/feed";
import { api, ApiError } from "../lib/api";
import { AdSlot } from "./AdSlot";
import { PostCard } from "./PostCard";

/*
 * The entries of a build log, in the owner's running order.
 *
 * This is not the Feed component. Feed paginates on a feed cursor and renders
 * nothing but cards; a build log needs the owner's controls sitting on each
 * entry — pin this one, is it pinned already — and its cursor carries three
 * sort keys rather than one. Sharing the component would have meant teaching
 * the feed about build logs.
 */

/** Matches AD_INTERVAL in Feed and on the server. Never place an ad first. */
const AD_INTERVAL = 6;

export function ProjectEntries({
  initialEntries,
  initialCursor,
  endpoint,
  ad,
  isOwner,
  projectId,
  pinnedPostId,
  emptyState,
}: {
  initialEntries: FeedPost[];
  initialCursor: string | null;
  /** e.g. "/projects/graham/death-guard/entries" — the cursor is appended. */
  endpoint: string;
  ad: ServedAd | null;
  isOwner: boolean;
  projectId: string;
  pinnedPostId: string | null;
  emptyState?: React.ReactNode;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // A reorder or a pin re-runs the loader, which hands down a different list.
  useEffect(() => {
    setEntries(initialEntries);
    setCursor(initialCursor);
    setError(null);
  }, [endpoint, initialEntries, initialCursor]);

  const loadMore = useCallback(async () => {
    if (loading || !cursor) return;
    setLoading(true);
    setError(null);

    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const page = await api.get<{
        posts: FeedPost[];
        nextCursor: string | null;
      }>(`${endpoint}${separator}cursor=${encodeURIComponent(cursor)}`);

      setEntries((current) => {
        // An entry can be posted while someone is reading, so page two can
        // repeat something from page one. Deduping by id keeps React keys
        // unique.
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError("Could not load more. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [cursor, endpoint, loading]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;

    const observer = new IntersectionObserver(
      (visible) => {
        if (visible[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  if (!entries.length) {
    return <div className="st-card p-10 text-center">{emptyState}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry, index) => (
        <div key={entry.id} className="contents">
          <div>
            <PostCard post={entry} />
            {isOwner ? (
              <PinControl
                projectId={projectId}
                postId={entry.id}
                pinned={entry.id === pinnedPostId}
              />
            ) : null}
          </div>

          {index > 0 && (index + 1) % AD_INTERVAL === 0 ? (
            <AdSlot slot="feed" ad={ad} />
          ) : null}
        </div>
      ))}

      <div ref={sentinel} aria-hidden className="h-px" />

      {loading ? (
        <p className="st-text-muted py-6 text-center text-sm">Loading more…</p>
      ) : null}

      {error ? (
        <div className="st-card p-4 text-center">
          <p className="st-error">{error}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="st-btn st-btn-ghost mt-3"
          >
            Try again
          </button>
        </div>
      ) : null}

      {!cursor && !loading ? (
        <p className="st-text-muted py-8 text-center text-sm">
          That is the whole log so far.
        </p>
      ) : null}
    </div>
  );
}

/** Owner-only: promote one entry to the "where it is now" slot, or clear it. */
function PinControl({
  projectId,
  postId,
  pinned,
}: {
  projectId: string;
  postId: string;
  pinned: boolean;
}) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (pinned) await api.delete(`/projects/${projectId}/pin`);
      else await api.post(`/projects/${projectId}/pin`, { postId });
      revalidator.revalidate();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not do that.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-3 px-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={pinned}
        className="st-text-muted hover:st-text-strong text-xs"
      >
        {busy ? "Saving…" : pinned ? "📌 Unpin" : "📌 Pin as current state"}
      </button>
      {error ? <span className="st-error text-xs">{error}</span> : null}
    </div>
  );
}
