import { useState } from "react";
import { buildShareLinks } from "../lib/share";

/**
 * Share a post.
 *
 * On a device with the native share sheet (phones, mostly) the "Share via…"
 * item hands off to it. Everywhere else, and always as a fallback, there is a
 * copy-link button and the explicit targets the hobby uses to pass work around.
 * No network SDKs and no cookies — every target is a plain link to a public
 * share endpoint.
 */
export function ShareButton({
  url,
  text,
  className = "",
}: {
  url: string;
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const targets = buildShareLinks(url, text);
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function nativeShare() {
    try {
      await navigator.share({ title: text, text, url });
      setOpen(false);
    } catch {
      // The person cancelled the sheet, or it is unavailable — leave the menu
      // open so they can pick a target instead.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context, or denied). Select-and-copy from
      // the address bar still works; nothing to do here.
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this post"
        className={`st-text-muted hover:st-text-strong flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${className}`}
      >
        <span aria-hidden>↗</span>
        Share
      </button>

      {open ? (
        <>
          {/* Click-away layer. Transparent, full-screen, closes the menu. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Share options"
            className="st-card absolute right-0 bottom-full z-50 mb-2 w-56 overflow-hidden p-1 shadow-lg"
          >
            {canNativeShare ? (
              <button
                type="button"
                role="menuitem"
                onClick={nativeShare}
                className="hover:st-raised flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
              >
                <span aria-hidden>📲</span> Share via…
              </button>
            ) : null}

            <button
              type="button"
              role="menuitem"
              onClick={copyLink}
              className="hover:st-raised flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
            >
              <span aria-hidden>{copied ? "✓" : "🔗"}</span>
              {copied ? "Link copied" : "Copy link"}
            </button>

            {targets.map((target) => (
              <a
                key={target.key}
                role="menuitem"
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="hover:st-raised flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
              >
                <span aria-hidden>↗</span> {target.label}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
