import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { api, ApiError } from "../lib/api";
import { excerpt } from "../lib/format";
import { moveEntry, sameOrder } from "../lib/build-log";

/*
 * The owner's running order.
 *
 * Up and down buttons, no drag and drop and no library for it. Dragging a card
 * inside a long scrolling page is unpleasant on a desktop and close to
 * impossible on a phone, which is where half of this will be used; a pair of
 * buttons works with a keyboard and a screen reader for free.
 *
 * Nothing is saved until "Save order" is pressed, so a mis-tap costs a tap
 * rather than a write, and the whole visible order goes up at once. That is on
 * purpose: an entry with a manual position sorts ahead of every entry without
 * one, so saving a partial order would shuffle entries the owner never touched.
 */

export type ReorderableEntry = {
  id: string;
  title: string | null;
  body: string | null;
  publishedAt: number | null;
  projectPosition: number | null;
  status: string;
};

export function ProjectReorder({
  projectId,
  entries,
}: {
  projectId: string;
  entries: ReorderableEntry[];
}) {
  const revalidator = useRevalidator();
  const [order, setOrder] = useState(entries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The loader is the source of truth; a save, a pin or a new entry all replace
  // this list wholesale rather than merging into the local copy.
  useEffect(() => {
    setOrder(entries);
    setSaved(false);
  }, [entries]);

  const dirty = !sameOrder(
    order.map((entry) => entry.id),
    entries.map((entry) => entry.id),
  );

  if (entries.length < 2) return null;

  function move(id: string, direction: "up" | "down") {
    setSaved(false);
    setOrder((current) => moveEntry(current, id, direction));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}/order`, {
        postIds: order.map((entry) => entry.id),
      });
      setSaved(true);
      revalidator.revalidate();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="st-card mt-6 overflow-hidden">
      <summary className="cursor-pointer p-3 text-sm font-medium">
        Reorder entries
      </summary>

      <div className="st-border border-t p-3">
        <p className="st-text-muted mb-3 text-xs">
          The log reads top to bottom. Move anything out of date order and the
          rest stays where the dates put it.
        </p>

        <ol className="flex flex-col gap-1.5">
          {order.map((entry, index) => (
            <li
              key={entry.id}
              className="st-border flex items-center gap-2 rounded-lg border p-2"
            >
              <span className="st-text-muted w-6 shrink-0 text-center text-xs tabular-nums">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate">
                  {entry.title || excerpt(entry.body, 60) || "Untitled entry"}
                </span>
                {entry.status !== "published" ? (
                  <span className="st-text-muted text-xs">Not published</span>
                ) : null}
              </span>

              <button
                type="button"
                onClick={() => move(entry.id, "up")}
                disabled={index === 0}
                aria-label={`Move "${entry.title ?? "entry"}" up`}
                className="st-btn st-btn-ghost px-2 py-1 text-sm disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(entry.id, "down")}
                disabled={index === order.length - 1}
                aria-label={`Move "${entry.title ?? "entry"}" down`}
                className="st-btn st-btn-ghost px-2 py-1 text-sm disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          ))}
        </ol>

        {error ? <p className="st-error mt-3">{error}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="st-btn st-btn-primary text-sm"
          >
            {saving ? "Saving…" : "Save order"}
          </button>

          <button
            type="button"
            onClick={() => setOrder(entries)}
            disabled={saving || !dirty}
            className="st-btn st-btn-ghost text-sm"
          >
            Reset
          </button>

          {saved && !dirty ? (
            <span className="st-text-muted text-xs">Order saved.</span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
