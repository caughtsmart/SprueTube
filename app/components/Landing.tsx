import { Link } from "react-router";
import type { ServedAd } from "../../server/services/ads";
import type { FeedPost } from "../../server/services/feed";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { PostCard } from "./PostCard";

/**
 * What a signed-out visitor sees.
 *
 * Real posts appear below the fold on purpose. A social network with no visible
 * content is a sign-up wall, and nobody signs up to a sign-up wall — they need
 * to see that other people are already here and that the work is good.
 */
export function Landing({
  posts,
  ad: _ad,
}: {
  posts: FeedPost[];
  ad: ServedAd | null;
}) {
  const { config } = useRoot();
  const showcase = posts
    .filter((post) => post.media.length > 0)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="py-10 text-center sm:py-16">
        <h1 className="font-display text-4xl leading-tight font-bold sm:text-5xl">
          From sprue to
          <span className="text-[var(--color-primer-500)]"> finished</span>.
        </h1>
        <p className="st-text-muted mx-auto mt-4 max-w-xl text-base leading-relaxed sm:text-lg">
          SprueTube is where miniature painters and model makers post what they
          are working on — half-primed, badly lit, unfinished and all. Follow a
          build from the first clipped part to the last highlight.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/signup" className="st-btn st-btn-primary px-6 py-3">
            Create an account
          </Link>
          <Link to="/explore" className="st-btn st-btn-ghost px-6 py-3">
            Have a look around
          </Link>
        </div>
        <p className="st-text-muted mt-4 text-xs">
          Free, 13+, and no algorithm deciding your hobby is out of fashion.
        </p>
      </section>

      {showcase.length ? (
        <section className="pb-12" aria-label="Recent work">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {showcase.map((post) => {
              const image = post.media[0];
              return (
                <Link
                  key={post.id}
                  to={`/posts/${post.id}`}
                  className="group relative aspect-square overflow-hidden rounded-lg"
                >
                  <img
                    src={imageSrc(config, image?.imageId, "thumbnail") ?? ""}
                    alt={image?.altText ?? ""}
                    loading="lazy"
                    decoding="async"
                    className={[
                      "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
                      post.sensitive ? "st-sensitive" : "",
                    ].join(" ")}
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[0.6875rem] text-white">
                    @{post.author.username}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 pb-12 sm:grid-cols-3">
        <Feature
          icon="🪚"
          title="Build logs, not just photos"
          body="Group posts into a project and the whole thing reads as one story — sprue, assembly, primer, first coat, done."
        />
        <Feature
          icon="🎨"
          title="Answer the paint question once"
          body="Tag the paints you used and they show under the photo, so nobody has to ask what you did for the red."
        />
        <Feature
          icon="🛡"
          title="Moderated properly"
          body="Report anything in two taps, block anyone, and a human looks at every report. No pile-ons."
        />
      </section>

      {posts.length ? (
        <section className="pb-16">
          <h2 className="mb-4 text-lg font-semibold">Fresh off the workbench</h2>
          <div className="flex flex-col gap-4">
            {posts.slice(0, 4).map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link to="/signup" className="st-btn st-btn-primary px-6 py-3">
              Join and post your own
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="st-card p-5">
      <p aria-hidden className="text-2xl">
        {icon}
      </p>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="st-text-muted mt-1.5 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
