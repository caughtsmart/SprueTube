/**
 * The mark: a sprue frame with one part clipped free.
 *
 * That moment — the click of the clippers, the part coming off the frame — is
 * the thing every person on this site has in common, whether they build 40k
 * squads or 1/35 tanks. It reads at 20px, which is what a favicon and a bottom
 * bar actually need.
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="SprueTube"
      fill="none"
    >
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        rx="5"
        fill="currentColor"
        className="text-[var(--color-sprue-800)]"
      />
      {/* The sprue frame */}
      <path
        d="M9 9.5h14M9 22.5h14M9.5 9v14M22.5 9v6"
        stroke="var(--color-sprue-500)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* The freed part, in primer orange */}
      <circle cx="22.5" cy="20" r="4" fill="var(--color-primer-500)" />
      <path
        d="M19.6 17.1 24 12.6"
        stroke="var(--color-primer-500)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
