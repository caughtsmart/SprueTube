import { useCallback, useEffect, useRef, useState } from "react";
import type { ServedAd } from "../../server/services/ads";
import type { FeedPost } from "../../server/services/feed";
import { api } from "../lib/api";
import { AdSlot } from "./AdSlot";
import { PostCard } from "./PostCard";

/** Matches AD_INTERVAL on the server. Never place an ad first. */
const AD_INTERVAL = 6;

export function Feed({
  initialPosts,
  initialCursor,
  endpoint,
  ad,
  emptyState,
}: {
  initialPosts: FeedPost[];
  initialCursor: string | null;
  /** e.g. "/feed?tab=discover" — the cursor is appended. */
  endpoint: string;
  ad: ServedAd | null;
  emptyState?: React.ReactNode;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // A new endpoint (tab switch, different tag) means a different list entirely.
  useEffect(() => {
    setPosts(initialPosts);
    setCursor(initialCursor);
    setError(null);
  }, [endpoint, initialPosts, initialCursor]);

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

      setPosts((current) => {
        // The feed is live; a post can arrive in page 2 that was already in
        // page 1. Deduping by id stops React key collisions and double renders.
        const seen = new Set(current.map((p) => p.id));
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
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      // Start fetching before the sentinel is actually visible, so the next
      // page is usually there by the time the reader gets to it.
      { rootMargin: "800px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  if (!posts.length) {
    return (
      <div className="st-card p-10 text-center">
        {emptyState ?? (
          <>
            <p className="text-4xl">🎨</p>
            <h2 className="mt-4 text-lg font-semibold">Nothing here yet</h2>
            <p className="st-text-muted mt-2 text-sm">
              Be the first to post something.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post, index) => (
        <div key={post.id} className="contents">
          <PostCard post={post} />
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
          That is everything for now.
        </p>
      ) : null}
    </div>
  );
}
