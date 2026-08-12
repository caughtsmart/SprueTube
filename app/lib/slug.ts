/*
 * Slugs for owner-scoped URLs — a build log at /@user/projects/:slug, a recipe
 * at /@user/recipes/:slug.
 *
 * Dependency-free, like taxonomy.ts, so the route that mints a slug and any
 * client that previews one share exactly one rule. The fallback differs by
 * kind ("project", "recipe") for the case where a title has no usable
 * characters at all — an emoji-only name still needs a URL.
 */
export function slugify(value: string, fallback = "project"): string {
  return (
    value
      .toLowerCase()
      // NFKD splits an accented letter into the letter plus a combining mark;
      // dropping the marks turns "Légion" into "legion" rather than "le-gion".
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      // The slice can land on a dash; a slug ending in '-' looks like a typo.
      .replace(/-+$/, "") || fallback
  );
}
