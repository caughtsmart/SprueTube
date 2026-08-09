import { useCallback, useEffect, useState } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/messages";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { listInbox, type InboxEntry } from "../../server/services/messaging";

export function meta() {
  return [
    { title: "Messages — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/messages");

  const page = await listInbox(scope.db, scope.viewer.userId);
  return { conversations: page.conversations, nextCursor: page.nextCursor };
}

export default function Messages({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();
  const [items, setItems] = useState<InboxEntry[]>(loaderData.conversations);
  const [cursor, setCursor] = useState(loaderData.nextCursor);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems(loaderData.conversations);
    setCursor(loaderData.nextCursor);
  }, [loaderData.conversations, loaderData.nextCursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.get<{
        conversations: InboxEntry[];
        nextCursor: string | null;
      }>(`/conversations?cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.conversations.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // The button stays; nothing is lost by trying again.
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  if (!items.length) {
    return (
      <div className="st-card mx-auto max-w-2xl p-10 text-center">
        <p className="text-4xl">✉</p>
        <h1 className="mt-4 text-lg font-semibold">No messages</h1>
        <p className="st-text-muted mt-2 text-sm">
          Threads start from someone's commission listing or their profile.
        </p>
        <Link to="/commissions" className="st-btn st-btn-ghost mt-4">
          Browse commission painters
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Messages</h1>

      <ul className="flex flex-col gap-2">
        {items.map((row) => (
          <li key={row.id}>
            <Link
              to={`/messages/${row.id}`}
              className={`st-card flex items-center gap-3 p-3 ${
                row.unread ? "border-l-2 border-l-[var(--color-primer-500)]" : ""
              }`}
            >
              <Avatar
                username={row.other.username}
                src={imageSrc(config, row.other.avatarImageId, "avatar")}
                size={40}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm ${
                      row.unread
                        ? "st-text-strong font-semibold"
                        : "st-text-strong font-medium"
                    }`}
                  >
                    {row.other.displayName}
                  </span>
                  <span className="st-text-muted shrink-0 text-xs">
                    {timeAgo(row.lastMessageAt)}
                  </span>
                </div>
                <p
                  className={`mt-0.5 truncate text-sm ${
                    row.unread ? "st-text-strong" : "st-text-muted"
                  }`}
                >
                  {row.lastMessagePreview ?? "No messages yet"}
                </p>
              </div>

              {row.unread ? (
                <span
                  aria-label="Unread"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primer-500)]"
                />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {cursor ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="st-btn st-btn-ghost"
          >
            {loading ? "Loading…" : "Older conversations"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
