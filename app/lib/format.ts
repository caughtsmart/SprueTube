/** Compact relative time: "4m", "3h", "2d", then a plain date. */
export function timeAgo(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);

  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`;

  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(new Date(unixSeconds * 1000).getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}

export function fullDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** 1200 → "1.2k". Keeps engagement counts from wrapping on a phone. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
  }
  const millions = value / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1).replace(/\.0$/, "") : Math.round(millions)}m`;
}

/**
 * Renders post text with #tags and @mentions linked.
 *
 * Returns segments rather than HTML — the caller renders them as React nodes,
 * so there is no path from user text to `dangerouslySetInnerHTML` anywhere in
 * the app. That is the whole point: post bodies are attacker-controlled.
 */
export type TextSegment =
  | { type: "text"; value: string }
  | { type: "tag"; value: string }
  | { type: "mention"; value: string }
  | { type: "link"; value: string };

export function parseBody(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /(https?:\/\/[^\s<]+)|#([a-zA-Z0-9_]{2,30})|@([a-zA-Z0-9_]{3,20})/g;

  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: body.slice(lastIndex, index) });
    }
    if (match[1]) segments.push({ type: "link", value: match[1] });
    else if (match[2]) segments.push({ type: "tag", value: match[2] });
    else if (match[3]) segments.push({ type: "mention", value: match[3] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", value: body.slice(lastIndex) });
  }
  return segments;
}

/** Trims a body down for meta descriptions and link previews. */
export function excerpt(body: string | null | undefined, max = 160): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
