import { useState } from "react";
import { api, ApiError } from "../lib/api";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "../lib/taxonomy";
import { useRoot } from "../root";

/**
 * Reporting has to be reachable from every piece of content, in two taps, by
 * anyone. That is not a nice-to-have: it is what the Online Safety Act expects
 * of a UK user-to-user service and what App Store review looks for in a UGC
 * app. Burying it behind a profile page fails both.
 */
export function ReportButton({
  subjectType,
  subjectId,
  className = "",
}: {
  subjectType: "post" | "comment" | "user" | "project" | "listing";
  subjectId: string;
  className?: string;
}) {
  const { viewer } = useRoot();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);

    try {
      await api.post("/reports", {
        subjectType,
        subjectId,
        reason,
        details: details.trim() || null,
      });
      setState("sent");
      setTimeout(() => setOpen(false), 1800);
    } catch (caught) {
      setState("error");
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not send that. Try again.",
      );
    }
  }

  if (!viewer) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report this"
        className={`st-text-muted hover:st-text-strong rounded-lg px-2 py-1 text-lg leading-none ${className}`}
      >
        ⋯
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Report content"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="st-card w-full max-w-md rounded-b-none sm:rounded-b-xl">
            {state === "sent" ? (
              <div className="p-6 text-center">
                <p className="text-3xl">✓</p>
                <h2 className="mt-3 text-lg font-semibold">Report sent</h2>
                <p className="st-text-muted mt-2 text-sm">
                  A moderator will look at this. Thanks for flagging it.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="p-5">
                <h2 className="text-lg font-semibold">What is wrong with it?</h2>
                <p className="st-text-muted mt-1 text-sm">
                  Reports are anonymous to the person you are reporting.
                </p>

                <fieldset className="mt-4 space-y-1">
                  <legend className="sr-only">Reason</legend>
                  {REPORT_REASONS.map((value) => (
                    <label
                      key={value}
                      className="hover:st-raised flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={value}
                        checked={reason === value}
                        onChange={() => setReason(value)}
                        className="accent-[var(--color-primer-500)]"
                      />
                      {REPORT_REASON_LABELS[value]}
                    </label>
                  ))}
                </fieldset>

                <label className="st-label mt-4">
                  Anything else we should know? (optional)
                </label>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="st-input resize-y"
                  placeholder="Context helps us act faster."
                />

                {error ? <p className="st-error">{error}</p> : null}

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="st-btn st-btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={state === "sending"}
                    className="st-btn st-btn-primary"
                  >
                    {state === "sending" ? "Sending…" : "Send report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
