/*
 * Client-safe URL builders.
 *
 * The server has equivalents in server/services/media.ts that read from `Env`.
 * These take the public config instead, because the browser has no bindings —
 * the Images account hash is shipped down in the root loader.
 */

export type MediaConfig = {
  imagesAccountHash: string;
};

export type ImageVariant = "thumbnail" | "avatar" | "feed" | "full" | "public";

/**
 * True when a config value is actually usable.
 *
 * wrangler.jsonc ships a `REPLACE_WITH_…` placeholder for the Images hash,
 * because it comes from a dashboard that may not be enabled yet. An empty check
 * alone is not enough: a placeholder is a non-empty string, so it would happily
 * build `imagedelivery.net/REPLACE_WITH_…/abc/feed` and the page would fill with
 * broken images. Returning null instead lets the UI fall back — initials for
 * avatars, no media block for posts.
 */
export function isConfigured(value: string | null | undefined): value is string {
  return Boolean(value) && !value!.startsWith("REPLACE_WITH_");
}

export function imageSrc(
  config: MediaConfig,
  imageId: string | null | undefined,
  variant: ImageVariant = "feed",
): string | null {
  if (!imageId || !isConfigured(config.imagesAccountHash)) return null;
  return `https://imagedelivery.net/${config.imagesAccountHash}/${imageId}/${variant}`;
}

/**
 * A deterministic placeholder for someone with no avatar yet.
 *
 * Derived from the username so it is stable across sessions and devices, and
 * built from the palette rather than a random colour so the feed still looks
 * like one product.
 */
const AVATAR_COLOURS = [
  "#ff7a2f",
  "#2bb3a5",
  "#8b5cf6",
  "#e2456b",
  "#3b82f6",
  "#d9a441",
];

export function avatarFallback(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return {
    colour: AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!,
    initials: username.slice(0, 2).toUpperCase(),
  };
}
