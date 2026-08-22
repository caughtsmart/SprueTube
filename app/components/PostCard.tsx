import { useState } from "react";
import { Link } from "react-router";
import type { FeedPost } from "../../server/services/feed";
import { api } from "../lib/api";
import { compactCount, parseBody, timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import {
  GAME_SYSTEM_LABELS,
  WIP_STAGE_SHORT,
  type GameSystem,
  type WipStage,
} from "../lib/taxonomy";
import { useRoot } from "../root";
import { Avatar } from "./Avatar";
import { ReportButton } from "./ReportButton";
import { ShareButton } from "./ShareButton";

export function PostCard({ post }: { post: FeedPost }) {
  const { viewer, config } = useRoot();

  const [liked, setLiked] = useState(post.viewerHasLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [saved, setSaved] = useState(post.viewerHasBookmarked);
  const [revealed, setRevealed] = useState(!post.sensitive);

  async function toggleLike() {
    if (!viewer) {
      window.location.href = "/login";
      return;
    }
    // Optimistic: the like is the single most-tapped control on the site and it
    // must feel instant. If the request fails we put it back.
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => count + (next ? 1 : -1));

    try {
      const result = next
        ? await api.post<{ likeCount: number }>(`/posts/${post.id}/like`)
        : await api.delete<{ likeCount: number }>(`/posts/${post.id}/like`);
      if (typeof result?.likeCount === "number") setLikeCount(result.likeCount);
    } catch {
      setLiked(!next);
      setLikeCount((count) => count + (next ? -1 : 1));
    }
  }

  async function toggleSave() {
    if (!viewer) {
      window.location.href = "/login";
      return;
    }
    const next = !saved;
    setSaved(next);
    try {
      if (next) await api.post(`/posts/${post.id}/bookmark`);
      else await api.delete(`/posts/${post.id}/bookmark`);
    } catch {
      setSaved(!next);
    }
  }

  return (
    <article className="st-card overflow-hidden">
      <header className="flex items-start gap-3 p-4 pb-3">
        <Link to={`/@${post.author.username}`}>
          <Avatar
            username={post.author.username}
            src={imageSrc(config, post.author.avatarImageId, "avatar")}
            size={40}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              to={`/@${post.author.username}`}
              className="st-text-strong truncate text-sm font-semibold hover:underline"
            >
              {post.author.displayName}
            </Link>
            <span className="st-text-muted truncate text-xs">
              @{post.author.username}
            </span>
            <span className="st-text-muted text-xs">·</span>
            <Link
              to={`/posts/${post.id}`}
              className="st-text-muted text-xs hover:underline"
            >
              {timeAgo(post.publishedAt ?? post.createdAt)}
            </Link>
          </div>

          {post.project ? (
            <p className="st-text-muted mt-0.5 text-xs">
              Part of{" "}
              <Link
                to={`/@${post.author.username}/projects/${post.project.slug}`}
                className="st-link font-medium"
              >
                {post.project.title}
              </Link>
            </p>
          ) : null}
        </div>

        <ReportButton subjectType="post" subjectId={post.id} />
      </header>

      {post.title ? (
        <h2 className="px-4 pb-2 text-base font-semibold">
          <Link to={`/posts/${post.id}`} className="hover:underline">
            {post.title}
          </Link>
        </h2>
      ) : null}

      {post.body ? (
        <div className="st-body px-4 pb-3 text-[0.9375rem] whitespace-pre-wrap">
          <BodyText body={post.body} />
        </div>
      ) : null}

      {post.media.length > 0 ? (
        <div className="relative">
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/40 text-sm font-medium text-white"
            >
              <span className="text-2xl">👁</span>
              Sensitive content — tap to view
            </button>
          ) : null}
          <div className={revealed ? "" : "st-sensitive pointer-events-none"}>
            <MediaBlock post={post} />
          </div>
        </div>
      ) : null}

      <MetaRow post={post} />

      {post.products.length > 0 ? <ProductStrip post={post} /> : null}

      <footer className="flex flex-wrap items-center gap-1 px-2 py-2">
        <ActionButton
          onClick={toggleLike}
          active={liked}
          label={liked ? "Unlike" : "Like"}
        >
          <span aria-hidden>{liked ? "♥" : "♡"}</span>
          {likeCount > 0 ? compactCount(likeCount) : "Like"}
        </ActionButton>

        <Link
          to={`/posts/${post.id}`}
          className="st-text-muted hover:st-text-strong flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
        >
          <span aria-hidden>💬</span>
          {post.commentCount > 0 ? compactCount(post.commentCount) : "Comment"}
        </Link>

        <ActionButton
          onClick={toggleSave}
          active={saved}
          label={saved ? "Remove from saved" : "Save"}
        >
          <span aria-hidden>{saved ? "★" : "☆"}</span>
          {saved ? "Saved" : "Save"}
        </ActionButton>

        <ShareButton
          url={`${config.siteUrl}/posts/${post.id}`}
          text={
            post.title
              ? `${post.title} — by @${post.author.username} on SprueTube`
              : `${post.author.displayName}'s work on SprueTube`
          }
        />
      </footer>
    </article>
  );
}

function ActionButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={[
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active
          ? "text-[var(--color-primer-500)]"
          : "st-text-muted hover:st-text-strong",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function BodyText({ body }: { body: string }) {
  return (
    <>
      {parseBody(body).map((segment, index) => {
        if (segment.type === "tag") {
          return (
            <Link
              key={index}
              to={`/tags/${segment.value}`}
              className="st-link font-medium"
            >
              #{segment.value}
            </Link>
          );
        }
        if (segment.type === "mention") {
          return (
            <Link
              key={index}
              to={`/@${segment.value}`}
              className="st-link font-medium"
            >
              @{segment.value}
            </Link>
          );
        }
        if (segment.type === "link") {
          return (
            <a
              key={index}
              href={segment.value}
              // User-supplied links get nofollow and noopener. This is a UGC
              // field; without nofollow the site becomes an SEO spam target
              // within weeks of anyone noticing it exists.
              rel="nofollow ugc noopener noreferrer"
              target="_blank"
              className="st-link break-all"
            >
              {segment.value}
            </a>
          );
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </>
  );
}

function MediaBlock({ post }: { post: FeedPost }) {
  const { config } = useRoot();
  const images = post.media;
  if (!images.length) return null;

  if (images.length === 1) {
    const image = images[0]!;
    return (
      <img
        src={imageSrc(config, image.imageId, "feed") ?? ""}
        alt={image.altText ?? ""}
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        loading="lazy"
        decoding="async"
        className="max-h-[42rem] w-full object-cover"
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-0.5">
      {images.slice(0, 4).map((image, index) => (
        <div key={image.id} className="relative">
          <img
            src={imageSrc(config, image.imageId, "thumbnail") ?? ""}
            alt={image.altText ?? ""}
            loading="lazy"
            decoding="async"
            className="aspect-square w-full object-cover"
          />
          {index === 3 && images.length > 4 ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-semibold text-white">
              +{images.length - 4}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MetaRow({ post }: { post: FeedPost }) {
  const chips: React.ReactNode[] = [];

  if (post.gameSystem) {
    chips.push(
      <Link key="system" to={`/systems/${post.gameSystem}`} className="st-chip">
        {GAME_SYSTEM_LABELS[post.gameSystem as GameSystem] ?? post.gameSystem}
      </Link>,
    );
  }
  if (post.wipStage) {
    chips.push(
      <span key="wip" className="st-chip">
        {WIP_STAGE_SHORT[post.wipStage as WipStage] ?? post.wipStage}
      </span>,
    );
  }
  if (post.scale) {
    chips.push(
      <span key="scale" className="st-chip">
        {post.scale}
      </span>,
    );
  }
  for (const tag of post.tags.slice(0, 4)) {
    chips.push(
      <Link key={`tag-${tag}`} to={`/tags/${tag}`} className="st-chip">
        #{tag}
      </Link>,
    );
  }

  if (!chips.length) return null;

  return <div className="flex flex-wrap gap-1.5 px-4 pt-3">{chips}</div>;
}

/**
 * The "paints used" strip.
 *
 * This is the commercial layer and it earns its place by being useful first:
 * the single most common comment under a painted miniature is "what did you use
 * for the red?". Answering that inline happens to also be a product link.
 */
function ProductStrip({ post }: { post: FeedPost }) {
  const { shopName } = useRoot().config;

  return (
    <div className="st-border mx-4 mt-3 flex overflow-hidden rounded-md border">
      {/*
        The rail marks this as commercial. It is the one place in the feed
        where a link earns money, and the hazard set exists to say so rather
        than to decorate.
      */}
      <span aria-hidden className="st-hazard-rail" />
      <div className="min-w-0 flex-1 p-3">
        <p className="st-text-muted mb-2 text-[0.6875rem] font-semibold tracking-wide uppercase">
          Paints and kit used
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {post.products.map((product) => (
            <li key={product.id}>
              {product.shopUrl ? (
                <a
                  href={product.shopUrl}
                  rel="sponsored noopener"
                  target="_blank"
                  className="st-chip hover:st-text-strong"
                  title={`Find ${product.name} at ${shopName}`}
                >
                  {product.brand ? `${product.brand} ` : ""}
                  {product.name}
                  <span aria-hidden>↗</span>
                </a>
              ) : (
                <span className="st-chip">
                  {product.brand ? `${product.brand} ` : ""}
                  {product.name}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
