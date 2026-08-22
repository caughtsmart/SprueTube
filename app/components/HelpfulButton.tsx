import { useState } from "react";
import { api } from "../lib/api";
import { compactCount } from "../lib/format";
import { useRoot } from "../root";

/**
 * "Mark this comment helpful" — the one place a useful tip in the comments gets
 * rewarded. It is the comment-like endpoint under a name that says what it is
 * for. The server refuses a self-mark, so this is only ever offered on other
 * people's comments.
 */
export function HelpfulButton({
  commentId,
  initialCount,
  initiallyMarked,
  /** Hidden entirely on your own comment — you cannot vouch for yourself. */
  canMark,
}: {
  commentId: string;
  initialCount: number;
  initiallyMarked: boolean;
  canMark: boolean;
}) {
  const { viewer } = useRoot();
  const [marked, setMarked] = useState(initiallyMarked);
  const [count, setCount] = useState(initialCount);

  async function toggle() {
    if (!viewer) {
      window.location.href = "/login";
      return;
    }
    const next = !marked;
    // Optimistic; reconcile with the server's count on success, revert on error.
    setMarked(next);
    setCount((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      const result = next
        ? await api.post<{ count: number }>(`/comments/${commentId}/like`)
        : await api.delete<{ count: number }>(`/comments/${commentId}/like`);
      if (typeof result?.count === "number") setCount(result.count);
    } catch {
      setMarked(!next);
      setCount((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  }

  // On your own comment there is nothing to press — just show the tally if any
  // other people have marked it.
  if (!canMark) {
    return count > 0 ? (
      <span className="st-text-muted text-xs">
        💡 {compactCount(count)} found this helpful
      </span>
    ) : null;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={marked}
      aria-label={marked ? "Remove helpful mark" : "Mark as helpful"}
      className={[
        "flex items-center gap-1 text-xs transition-colors",
        marked
          ? "text-[var(--color-primer-500)]"
          : "st-text-muted hover:st-text-strong",
      ].join(" ")}
    >
      <span aria-hidden>💡</span>
      {count > 0 ? (
        <>
          {compactCount(count)}
          <span className="sr-only"> found this helpful</span>
        </>
      ) : (
        "Helpful"
      )}
    </button>
  );
}
