/*
 * Client-safe URL builders.
 *
 * The server has equivalents in server/services/media.ts that read from `Env`.
 * These take the public config instead, because the browser has no bindings —
 * the account hash and Stream subdomain are shipped down in the root loader.
 */

export type MediaConfig = {
  imagesAccountHash: string;
  streamSubdomain: string;
};

export type ImageVariant = "thumbnail" | "avatar" | "feed" | "full" | "public";

export function imageSrc(
  config: MediaConfig,
  imageId: string | null | undefined,
  variant: ImageVariant = "feed",
): string | null {
  if (!imageId || !config.imagesAccountHash) return null;
  return `https://imagedelivery.net/${config.imagesAccountHash}/${imageId}/${variant}`;
}

export function streamIframeSrc(
  config: MediaConfig,
  uid: string | null | undefined,
): string | null {
  if (!uid || !config.streamSubdomain) return null;
  return `https://${config.streamSubdomain}/${uid}/iframe`;
}

export function streamPosterSrc(
  config: MediaConfig,
  uid: string | null | undefined,
): string | null {
  if (!uid || !config.streamSubdomain) return null;
  return `https://${config.streamSubdomain}/${uid}/thumbnails/thumbnail.jpg?time=1s`;
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
