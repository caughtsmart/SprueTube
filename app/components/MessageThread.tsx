import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import {
  MAX_MESSAGE_LENGTH,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "../lib/taxonomy";

export type ThreadMessage = {
  id: string;
  senderId: string;
  /** Null once withdrawn. The row survives for moderators; the text does not. */
  body: string | null;
  removed: boolean;
  createdAt: number;
};

/**
 * One conversation.
 *
 * The server decides who may read this; the component only draws it. Nothing
 * here treats the conversation id as a permission — every call it makes is
 * re-checked against the session on the other end.
 */
export function MessageThread({
  conversationId,
  viewerId,
  otherName,
  initialMessages,
  initialCursor,
}: {
  conversationId: string;
  viewerId: string;
  otherName: string;
  /** Newest first, as the API returns them. */
  initialMessages: ThreadMessage[];
  initialCursor: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [cursor, setCursor] = useState(initialCursor);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Arriving at a thread is the act of reading it.
  useEffect(() => {
    void api.post(`/conversations/${conversationId}/read`).catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, []);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.get<{
        messages: ThreadMessage[];
        nextCursor: string | null;
      }>(
        `/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`,
      );
      setMessages((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.messages.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError("Could not load the earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loadingOlder]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const sent = await api.post<{ id: string; createdAt: number }>(
        `/conversations/${conversationId}/messages`,
        { body },
      );
      setMessages((current) => [
        { id: sent.id, senderId: viewerId, body, removed: false, createdAt: sent.createdAt },
        ...current,
      ]);
      setDraft("");
      requestAnimationFrame(() =>
        bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That did not send.",
      );
    } finally {
      setSending(false);
    }
  }

  async function withdraw(id: string) {
    const ok = window.confirm(
      "Withdraw this message? They will see that something was here.",
    );
    if (!ok) return;

    try {
      await api.delete(`/messages/${id}`);
      setMessages((current) =>
        current.map((row) =>
          row.id === id ? { ...row, body: null, removed: true } : row,
        ),
      );
    } catch {
      setError("Could not withdraw that.");
    }
  }

  // Oldest at the top, which is how a conversation reads.
  const inOrder = [...messages].reverse();

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1">
        {cursor ? (
          <div className="mb-3 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="st-btn st-btn-ghost text-sm"
            >
              {loadingOlder ? "Loading…" : "Earlier messages"}
            </button>
          </div>
        ) : null}

        {inOrder.length ? (
          <ol className="flex flex-col gap-2">
            {inOrder.map((row) => (
              <MessageRow
                key={row.id}
                message={row}
                mine={row.senderId === viewerId}
                onWithdraw={() => void withdraw(row.id)}
              />
            ))}
          </ol>
        ) : (
          <p className="st-text-muted py-10 text-center text-sm">
            Nothing yet. Say hello to {otherName}.
          </p>
        )}

        <div ref={bottom} aria-hidden className="h-px" />
      </div>

      {error ? <p className="st-error mt-2">{error}</p> : null}

      <form onSubmit={send} className="st-card mt-4 p-3">
        <label htmlFor="message-body" className="sr-only">
          Message {otherName}
        </label>
        <textarea
          id="message-body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. Long messages are rare
            // here and a send button that needs a reach is worse on a phone.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(event as unknown as React.FormEvent);
            }
          }}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          className="st-input resize-y"
          placeholder={`Message ${otherName}…`}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="st-text-muted text-xs">
            {draft.length}/{MAX_MESSAGE_LENGTH}
          </span>
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="st-btn st-btn-primary text-sm"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageRow({
  message,
  mine,
  onWithdraw,
}: {
  message: ThreadMessage;
  mine: boolean;
  onWithdraw: () => void;
}) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        <div
          className={[
            "rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed whitespace-pre-wrap",
            mine
              ? "bg-[var(--color-primer-500)] text-[#14161b]"
              : "st-raised st-border border",
            message.removed ? "italic opacity-70" : "",
          ].join(" ")}
        >
          {message.removed ? "Message withdrawn" : message.body}
        </div>

        <div
          className={`st-text-muted mt-1 flex items-center gap-2 text-xs ${
            mine ? "justify-end" : ""
          }`}
        >
          <span>{timeAgo(message.createdAt)}</span>
          {message.removed ? null : mine ? (
            <button
              type="button"
              onClick={onWithdraw}
              className="hover:st-text-strong"
            >
              Withdraw
            </button>
          ) : (
            <ReportMessage messageId={message.id} />
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Reporting, per message.
 *
 * Not the shared ReportButton: that component posts to /reports, which cannot
 * check whether the person reporting is actually in the thread. Messages need
 * that check, so they get their own endpoint and this small control to reach
 * it. Everything else — the reasons, the wording — is the same, so a report
 * from here looks like every other report in the queue.
 */
function ReportMessage({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("harassment");
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
      await api.post(`/messages/${messageId}/report`, {
        reason,
        details: details.trim() || null,
      });
      setState("sent");
      setTimeout(() => setOpen(false), 1800);
    } catch (caught) {
      setState("error");
      setError(
        caught instanceof ApiError ? caught.message : "Could not send that.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:st-text-strong"
      >
        Report
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Report this message"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="st-card w-full max-w-md rounded-b-none text-left sm:rounded-b-xl">
            {state === "sent" ? (
              <div className="p-6 text-center">
                <p className="text-3xl">✓</p>
                <h2 className="mt-3 text-lg font-semibold">Report sent</h2>
                <p className="st-text-muted mt-2 text-sm">
                  A moderator can read the message even if it is withdrawn.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="p-5">
                <h2 className="text-lg font-semibold">
                  What is wrong with this message?
                </h2>
                <p className="st-text-muted mt-1 text-sm">
                  Reports are anonymous to the person you are reporting. If you
                  want them gone entirely, block them from their profile.
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
                        name={`reason-${messageId}`}
                        value={value}
                        checked={reason === value}
                        onChange={() => setReason(value)}
                        className="accent-[var(--color-primer-500)]"
                      />
                      {REPORT_REASON_LABELS[value]}
                    </label>
                  ))}
                </fieldset>

                <label htmlFor={`details-${messageId}`} className="st-label mt-4">
                  Anything else we should know? (optional)
                </label>
                <textarea
                  id={`details-${messageId}`}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="st-input resize-y"
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
