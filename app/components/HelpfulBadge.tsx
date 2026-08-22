/**
 * The "Helpful" badge — shown next to someone who has genuinely helped in the
 * comments (see server/services/helpful.ts for how it is earned). Small and
 * quiet on purpose: it is a nod, not a trophy shelf.
 */
export function HelpfulBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-[var(--color-primer-500)]/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--color-primer-500)] ${className}`}
      title="Marked helpful by other painters in the comments"
    >
      <span aria-hidden>💡</span>
      Helpful
    </span>
  );
}
