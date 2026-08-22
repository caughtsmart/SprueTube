/*
 * Share links.
 *
 * Pure and dependency-free so it can be tested and so it never drags anything
 * into a bundle. The web app calls navigator.share where the browser has it
 * (phones, mostly) and falls back to this list of explicit targets everywhere
 * else — the same set the hobby actually uses to pass work around.
 *
 * Every target opens the network's own composer with the post's URL and a
 * short line prefilled. Nothing here calls a network's SDK or sets a cookie;
 * they are ordinary links to public share endpoints.
 */

export type ShareTarget = {
  /** Stable key, handy for React lists and tests. */
  key: string;
  label: string;
  href: string;
};

/**
 * Build the share targets for a URL and a bit of text.
 *
 * `url` should be absolute — a share link with a relative URL is useless once
 * it leaves the site. Callers pass `location.href` or a server-built absolute
 * URL.
 */
export function buildShareLinks(url: string, text: string): ShareTarget[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const tu = encodeURIComponent(`${text} ${url}`);

  return [
    {
      key: "x",
      label: "X / Twitter",
      href: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    },
    {
      key: "reddit",
      label: "Reddit",
      href: `https://www.reddit.com/submit?url=${u}&title=${t}`,
    },
    {
      key: "bluesky",
      label: "Bluesky",
      href: `https://bsky.app/intent/compose?text=${tu}`,
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${tu}`,
    },
    {
      key: "email",
      label: "Email",
      href: `mailto:?subject=${t}&body=${tu}`,
    },
  ];
}
