import { useState } from "react";
import { data, Link, useRevalidator } from "react-router";
import type { Route } from "./+types/post";
import { AdSlot } from "../components/AdSlot";
import { Avatar } from "../components/Avatar";
import { PostCard } from "../components/PostCard";
import { ReportButton } from "../components/ReportButton";
import { api, ApiError } from "../lib/api";
import { getScope } from "../lib/data.server";
import { excerpt, timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { pickAd } from "../../server/services/ads";
import { getPost } from "../../server/services/feed";
import { comment as commentTable, profile } from "../../server/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.post) return [{ title: "Post — SprueTube" }];

  const post = loaded.post;
  const title = post.title ?? `${post.author.displayName} on SprueTube`;
  const description =
    excerpt(post.body) || `A post by @${post.author.username} on SprueTube.`;

  return [
    { title: `${title} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    ...(loaded.ogImage
      ? [
          { property: "og:image", content: loaded.ogImage },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [{ name: "twitter:card", content: "summary" }]),
    // A followers-only or sensitive post should not be indexed.
    ...(post.sensitive ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  const post = await getPost(
    scope.db,
    params.postId,
    scope.viewer?.userId ?? null,
  );
  if (!post) {
    throw data({ message: "That post is not here." }, { status: 404 });
  }

  const [comments, ad] = await Promise.all([
    scope.db
      .select({
        id: commentTable.id,
        body: commentTable.body,
        parentId: commentTable.parentId,
        likeCount: commentTable.likeCount,
        createdAt: commentTable.createdAt,
        authorUsername: profile.username,
        authorDisplayName: profile.displayName,
        authorAvatarImageId: profile.avatarImageId,
      })
      .from(commentTable)
      .innerJoin(profile, eq(profile.userId, commentTable.authorId))
      .where(
        and(
          eq(commentTable.postId, params.postId),
          eq(commentTable.status, "published"),
          isNull(commentTable.deletedAt),
        ),
      )
      .orderBy(asc(commentTable.createdAt))
      .limit(200),
    pickAd(scope.db, "post"),
  ]);

  const firstImage = post.media[0];
  const ogImage =
    firstImage && !post.sensitive
      ? `https://imagedelivery.net/${scope.env.CF_IMAGES_ACCOUNT_HASH}/${firstImage.imageId}/full`
      : null;

  return { post, comments, ad, ogImage };
}

export default function PostPage({ loaderData, params }: Route.ComponentProps) {
  const { viewer, config } = useRoot();
  const revalidator = useRevalidator();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roots = loaderData.comments.filter((c) => !c.parentId);
  const repliesFor = (id: string) =>
    loaderData.comments.filter((c) => c.parentId === id);

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;

    setSending(true);
    setError(null);

    try {
      await api.post(`/posts/${params.postId}/comments`, {
        body: body.trim(),
        parentId: replyTo,
      });
      setBody("");
      setReplyTo(null);
      // Re-run the loader so the new comment appears with its real id and
      // timestamp rather than an optimistic guess we would have to reconcile.
      revalidator.revalidate();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not post that.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PostCard post={loaderData.post} />

      <section className="mt-6" aria-label="Comments">
        <h2 className="mb-3 text-base font-semibold">
          {loaderData.post.commentCount === 1
            ? "1 comment"
            : `${loaderData.post.commentCount} comments`}
        </h2>

        {viewer ? (
          <form onSubmit={submitComment} className="st-card mb-4 p-3">
            {replyTo ? (
              <p className="st-text-muted mb-2 text-xs">
                Replying to a comment ·{" "}
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="st-link"
                >
                  cancel
                </button>
              </p>
            ) : null}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={2}
              maxLength={2000}
              className="st-input resize-y"
              placeholder="Say something useful — what worked, what you would try."
              aria-label="Write a comment"
            />
            {error ? <p className="st-error">{error}</p> : null}
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="st-btn st-btn-primary text-sm"
              >
                {sending ? "Posting…" : "Comment"}
              </button>
            </div>
          </form>
        ) : (
          <div className="st-card mb-4 p-4 text-center text-sm">
            <Link to="/login" className="st-link font-medium">
              Sign in
            </Link>{" "}
            to join the conversation.
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {roots.map((item) => (
            <li key={item.id} className="st-card p-3">
              <CommentRow
                comment={item}
                avatarUrl={imageSrc(config, item.authorAvatarImageId, "avatar")}
                onReply={() => setReplyTo(item.id)}
                canReply={Boolean(viewer)}
              />

              {repliesFor(item.id).length ? (
                <ul className="st-border mt-3 ml-4 flex flex-col gap-3 border-l pl-4">
                  {repliesFor(item.id).map((reply) => (
                    <li key={reply.id}>
                      <CommentRow
                        comment={reply}
                        avatarUrl={imageSrc(
                          config,
                          reply.authorAvatarImageId,
                          "avatar",
                        )}
                        onReply={() => setReplyTo(item.id)}
                        canReply={Boolean(viewer)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        {!roots.length ? (
          <p className="st-text-muted py-6 text-center text-sm">
            No comments yet. Be the first.
          </p>
        ) : null}
      </section>

      <AdSlot slot="post" ad={loaderData.ad} className="mt-8" />
    </div>
  );
}

type CommentData = Route.ComponentProps["loaderData"]["comments"][number];

function CommentRow({
  comment,
  avatarUrl,
  onReply,
  canReply,
}: {
  comment: CommentData;
  avatarUrl: string | null;
  onReply: () => void;
  canReply: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Link to={`/@${comment.authorUsername}`}>
        <Avatar
          username={comment.authorUsername}
          src={avatarUrl}
          size={32}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to={`/@${comment.authorUsername}`}
            className="st-text-strong text-sm font-semibold hover:underline"
          >
            {comment.authorDisplayName}
          </Link>
          <span className="st-text-muted text-xs">
            {timeAgo(comment.createdAt)}
          </span>
        </div>

        <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
          {comment.body}
        </p>

        {canReply ? (
          <button
            type="button"
            onClick={onReply}
            className="st-text-muted hover:st-text-strong mt-1.5 text-xs"
          >
            Reply
          </button>
        ) : null}
      </div>

      <ReportButton subjectType="comment" subjectId={comment.id} />
    </div>
  );
}
