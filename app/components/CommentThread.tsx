import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { api, ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { Avatar } from "./Avatar";
import { ReportButton } from "./ReportButton";

/*
 * One comment thread, wherever it is attached.
 *
 * Comments now hang off three different things — a post, a photograph inside a
 * post, and a build log — and the only thing that changes between them is the
 * endpoint. Rendering them from one component is what stops a reply box on a
 * photo from slowly acquiring different manners to the one on a post.
 */

export type CommentLeaf = {
  id: string;
  body: string;
  createdAt: number;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarImageId: string | null;
};

export type CommentNode = CommentLeaf & { replies: CommentLeaf[] };

export function CommentThread({
  comments,
  endpoint,
  placeholder = "Say something useful — what worked, what you would try.",
  emptyText = "No comments yet. Be the first.",
  signedOutPrompt = "to join the conversation.",
}: {
  comments: CommentNode[];
  /** Where a new comment is POSTed, e.g. `/projects/prj_1/comments`. */
  endpoint: string;
  placeholder?: string;
  emptyText?: string;
  signedOutPrompt?: string;
}) {
  const { viewer } = useRoot();
  const revalidator = useRevalidator();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;

    setSending(true);
    setError(null);

    try {
      await api.post(endpoint, { body: body.trim(), parentId: replyTo });
      setBody("");
      setReplyTo(null);
      // Re-run the loader rather than guessing at an optimistic row: the new
      // comment needs a real id and timestamp, and reconciling a guess with the
      // server's answer is more code than a second round trip is worth here.
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
    <>
      {viewer ? (
        <form onSubmit={submit} className="st-card mb-4 p-3">
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
            placeholder={placeholder}
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
          {signedOutPrompt}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {comments.map((item) => (
          <li key={item.id} className="st-card p-3">
            <CommentRow
              comment={item}
              onReply={() => setReplyTo(item.id)}
              canReply={Boolean(viewer)}
            />

            {item.replies.length ? (
              <ul className="st-border mt-3 ml-4 flex flex-col gap-3 border-l pl-4">
                {item.replies.map((reply) => (
                  <li key={reply.id}>
                    <CommentRow
                      comment={reply}
                      // A reply to a reply attaches to the root, matching what
                      // the server does with the parent id it is sent.
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

      {!comments.length ? (
        <p className="st-text-muted py-6 text-center text-sm">{emptyText}</p>
      ) : null}
    </>
  );
}

function CommentRow({
  comment,
  onReply,
  canReply,
}: {
  comment: CommentLeaf;
  onReply: () => void;
  canReply: boolean;
}) {
  const { config } = useRoot();

  return (
    <div className="flex gap-3">
      <Link to={`/@${comment.authorUsername}`}>
        <Avatar
          username={comment.authorUsername}
          src={imageSrc(config, comment.authorAvatarImageId, "avatar")}
          size={32}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to={`/@${comment.authorUsername}`}
            className="st-text-strong truncate text-sm font-semibold hover:underline"
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
