import { useState } from "react";
import { data, Link, redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/moderation";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { timeAgo } from "../lib/format";
import { getReportQueue } from "../../server/services/moderation";
import { REPORT_REASON_LABELS } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Moderation — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/moderation");

  const { role } = scope.viewer.profile;
  if (role !== "moderator" && role !== "admin") {
    throw data({ message: "Moderators only." }, { status: 403 });
  }

  return {
    reports: await getReportQueue(scope.db),
    isAdmin: role === "admin",
  };
}

export default function Moderation({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(
    report: (typeof loaderData.reports)[number],
    action: string,
    reason?: string,
  ) {
    setBusy(report.id);
    try {
      await api.post("/moderation/actions", {
        action,
        subjectType: report.subjectType,
        subjectId: report.subjectId,
        reportId: report.id,
        reason: reason ?? null,
        notifyUser: action !== "dismiss_report",
      });
      revalidator.revalidate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold">Moderation queue</h1>
      <p className="st-text-muted mt-1 mb-5 text-sm">
        Highest priority first. Child safety, illegal content and threats jump
        the queue regardless of when they were reported.
      </p>

      {!loaderData.reports.length ? (
        <div className="st-card p-10 text-center">
          <p className="text-4xl">✓</p>
          <h2 className="mt-4 text-lg font-semibold">Queue is clear</h2>
          <p className="st-text-muted mt-2 text-sm">Nothing waiting.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {loaderData.reports.map((report) => (
            <li key={report.id} className="st-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`st-chip ${
                    report.priority >= 80
                      ? "border-red-500/60 text-red-400"
                      : ""
                  }`}
                >
                  {REPORT_REASON_LABELS[
                    report.reason as keyof typeof REPORT_REASON_LABELS
                  ] ?? report.reason}
                </span>
                <span className="st-chip">{report.subjectType}</span>
                <span className="st-text-muted text-xs">
                  {timeAgo(report.createdAt)}
                  {report.reporter ? ` · by @${report.reporter.username}` : ""}
                </span>
              </div>

              {report.details ? (
                <p className="st-text-muted mt-2 text-sm italic">
                  “{report.details}”
                </p>
              ) : null}

              <div className="st-border mt-3 rounded-lg border p-3 text-sm">
                {report.subject ? (
                  <Subject subject={report.subject} />
                ) : (
                  <p className="st-text-muted">
                    The reported item no longer exists.
                  </p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {report.subjectType === "post" ? (
                  <>
                    <ActionButton
                      onClick={() => act(report, "remove_post", "Breach of the community rules.")}
                      busy={busy === report.id}
                      tone="danger"
                    >
                      Remove post
                    </ActionButton>
                    <ActionButton
                      onClick={() => act(report, "mark_sensitive")}
                      busy={busy === report.id}
                    >
                      Mark sensitive
                    </ActionButton>
                  </>
                ) : null}

                {report.subjectType === "comment" ? (
                  <ActionButton
                    onClick={() => act(report, "remove_comment", "Breach of the community rules.")}
                    busy={busy === report.id}
                    tone="danger"
                  >
                    Remove comment
                  </ActionButton>
                ) : null}

                {report.subjectType === "user" ? (
                  <ActionButton
                    onClick={() => act(report, "suspend_user", "Breach of the community rules.")}
                    busy={busy === report.id}
                    tone="danger"
                  >
                    Suspend account
                  </ActionButton>
                ) : null}

                <ActionButton
                  onClick={() => act(report, "dismiss_report")}
                  busy={busy === report.id}
                >
                  Dismiss
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Subject({
  subject,
}: {
  subject: NonNullable<
    Route.ComponentProps["loaderData"]["reports"][number]["subject"]
  >;
}) {
  if (subject.type === "post") {
    return (
      <>
        <p className="st-text-muted mb-1 text-xs">
          Post by @{subject.authorUsername} · {subject.status}
        </p>
        <p className="whitespace-pre-wrap">{subject.body || "(no text)"}</p>
        <Link to={`/posts/${subject.id}`} className="st-link mt-2 block text-xs">
          Open the post ↗
        </Link>
      </>
    );
  }

  if (subject.type === "comment") {
    return (
      <>
        <p className="st-text-muted mb-1 text-xs">
          Comment by @{subject.authorUsername}
        </p>
        <p className="whitespace-pre-wrap">{subject.body}</p>
        <Link
          to={`/posts/${subject.postId}`}
          className="st-link mt-2 block text-xs"
        >
          Open the thread ↗
        </Link>
      </>
    );
  }

  return (
    <>
      <p className="st-text-muted mb-1 text-xs">Account · {subject.status}</p>
      <p>
        {subject.displayName}{" "}
        <span className="st-text-muted">@{subject.username}</span>
      </p>
      <Link to={`/@${subject.username}`} className="st-link mt-2 block text-xs">
        Open the profile ↗
      </Link>
    </>
  );
}

function ActionButton({
  onClick,
  busy,
  tone,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`st-btn text-sm ${
        tone === "danger"
          ? "border border-red-500/50 bg-transparent text-red-400"
          : "st-btn-ghost"
      }`}
    >
      {children}
    </button>
  );
}
