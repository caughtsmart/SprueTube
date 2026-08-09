import { Link } from "react-router";
import type {
  HighlightImage,
  HighlightProject,
  Highlights as HighlightData,
} from "../../server/services/highlights";
import { compactCount } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";

/**
 * The best work on the site, on the homepage.
 *
 * Kept quiet on purpose: small type, no numbers larger than the work they
 * describe, no "trending" and no rank badges. It is here so a visitor can see
 * what good looks like here, not to tell anyone what to chase.
 */
export function Highlights({ highlights }: { highlights: HighlightData }) {
  if (!highlights.projects.length && !highlights.images.length) return null;

  return (
    <div className="flex flex-col gap-6">
      {highlights.projects.length ? (
        <BuildLogs projects={highlights.projects} />
      ) : null}
      {highlights.images.length ? (
        <Photographs images={highlights.images} />
      ) : null}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="st-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

function BuildLogs({ projects }: { projects: HighlightProject[] }) {
  const { config } = useRoot();

  return (
    <section aria-label="Most-liked build logs">
      <SectionHeading>Most-liked build logs</SectionHeading>
      <ul className="grid gap-3 sm:grid-cols-3">
        {projects.map((entry) => {
          const src = imageSrc(config, entry.coverImageId, "thumbnail");
          return (
            <li key={entry.id} className="st-card overflow-hidden">
              <Link
                to={`/@${entry.owner.username}/projects/${entry.slug}`}
                className="block"
              >
                {/* imageSrc is null before Cloudflare Images is configured, and
                    a build log can also simply have no photo in it yet. */}
                {src ? (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="st-raised aspect-[4/3] w-full" aria-hidden />
                )}
                <div className="p-3">
                  <p className="st-text-strong truncate text-sm font-semibold">
                    {entry.title}
                  </p>
                  <p className="st-text-muted mt-0.5 truncate text-xs">
                    @{entry.owner.username}
                  </p>
                  <p className="st-text-muted mt-1.5 text-xs">
                    {compactCount(entry.likeTotal)} likes across{" "}
                    {entry.postsCounted}{" "}
                    {entry.postsCounted === 1 ? "post" : "posts"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Photographs({ images }: { images: HighlightImage[] }) {
  const { config } = useRoot();

  return (
    <section aria-label="Most-liked photographs">
      <SectionHeading>Most-liked photographs</SectionHeading>
      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {images.map((image) => {
          const src = imageSrc(config, image.imageId, "thumbnail");
          return (
            <li key={image.mediaId}>
              <Link
                to={`/posts/${image.postId}`}
                className="group relative block aspect-square overflow-hidden rounded-lg"
              >
                {src ? (
                  <img
                    src={src}
                    alt={image.altText ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="st-raised h-full w-full" aria-hidden />
                )}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[0.625rem] text-white">
                  <span className="truncate">@{image.author.username}</span>
                  <span className="shrink-0" aria-hidden>
                    ♥ {compactCount(image.likeCount)}
                  </span>
                  <span className="sr-only">
                    {image.likeCount} {image.likeCount === 1 ? "like" : "likes"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
