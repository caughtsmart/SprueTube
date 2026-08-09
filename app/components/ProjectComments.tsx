import { CommentThread, type CommentNode } from "./CommentThread";

/**
 * Comments on the build log itself.
 *
 * Distinct from comments on an entry, and worth the separate place: the useful
 * conversation about a long project is usually about the project — the colour
 * scheme, whether the basing works, what to do with the last squad — and
 * hanging it off whichever entry happened to be open at the time buries it.
 */
export function ProjectComments({
  projectId,
  commentCount,
  comments,
}: {
  projectId: string;
  commentCount: number;
  comments: CommentNode[];
}) {
  return (
    <section className="mt-10" aria-label="Comments on this build log">
      <h2 className="text-base font-semibold">
        {commentCount === 1
          ? "1 comment on the build log"
          : `${commentCount} comments on the build log`}
      </h2>
      <p className="st-text-muted mt-1 mb-3 text-sm">
        About the project as a whole. To talk about one entry, comment on the
        entry itself.
      </p>

      <CommentThread
        comments={comments}
        endpoint={`/projects/${projectId}/comments`}
        placeholder="How is it coming along? What would you try next?"
        emptyText="Nothing said about this build log yet."
        signedOutPrompt="to comment on this build log."
      />
    </section>
  );
}
