import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { CommentThread, type CommentNode } from "./CommentThread";

/*
 * Comments about one photograph rather than the whole entry.
 *
 * An entry can carry ten photos of the same model at ten stages, and "the
 * shading on the cloak is lovely" is useless if nobody can tell which cloak.
 * A comment with a media id names the picture; without one it is about the
 * entry, exactly as every comment was before.
 *
 * Each photo is collapsed behind a disclosure rather than laid out open. Ten
 * open threads under one entry is a wall, and the count in the summary is
 * enough to tell you whether it is worth opening.
 */

export type MediaThread = { mediaId: string; comments: CommentNode[] };

export type CommentableImage = {
  id: string;
  imageId: string;
  altText: string | null;
};

export function ImageComments({
  postId,
  images,
  threads,
  sensitive = false,
}: {
  postId: string;
  images: CommentableImage[];
  threads: MediaThread[];
  /** Blurs the thumbnails, matching how the entry itself is shown. */
  sensitive?: boolean;
}) {
  const { config } = useRoot();
  if (!images.length) return null;

  const byMedia = new Map(threads.map((thread) => [thread.mediaId, thread]));

  return (
    <section className="mt-4" aria-label="Comments on individual photos">
      <h3 className="st-text-muted mb-2 text-[0.6875rem] font-semibold tracking-wide uppercase">
        Talk about one photo
      </h3>

      <ul className="flex flex-col gap-2">
        {images.map((image, index) => {
          const comments = byMedia.get(image.id)?.comments ?? [];
          const total = comments.reduce(
            (sum, comment) => sum + 1 + comment.replies.length,
            0,
          );
          const thumbnail = imageSrc(config, image.imageId, "thumbnail");

          return (
            <li key={image.id} className="st-card overflow-hidden">
              <details>
                <summary className="flex cursor-pointer items-center gap-3 p-3">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={image.altText ?? ""}
                      loading="lazy"
                      decoding="async"
                      className={[
                        "h-12 w-12 shrink-0 rounded-lg object-cover",
                        sensitive ? "st-sensitive" : "",
                      ].join(" ")}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="st-border flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-lg"
                    >
                      🖼
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="st-text-strong block text-sm font-medium">
                      Photo {index + 1}
                    </span>
                    <span className="st-text-muted block truncate text-xs">
                      {image.altText ||
                        (total
                          ? `${total} ${total === 1 ? "comment" : "comments"}`
                          : "No comments on this one yet")}
                    </span>
                  </span>

                  {total ? (
                    <span className="st-chip shrink-0">{total}</span>
                  ) : null}
                </summary>

                <div className="st-border border-t px-3 pt-3 pb-3">
                  <CommentThread
                    comments={comments}
                    endpoint={`/posts/${postId}/media/${image.id}/comments`}
                    placeholder="What do you want to know about this photo?"
                    emptyText="Nothing about this photo yet."
                    signedOutPrompt="to comment on this photo."
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
