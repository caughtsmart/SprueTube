import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api";
import { useRoot } from "../root";
import { CONTACT_EMAIL } from "../lib/legal";
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  MAX_FEEDBACK_BODY,
  MAX_FEEDBACK_TITLE,
  type FeedbackKind,
} from "../lib/taxonomy";

/*
 * Bug reports and feature requests.
 *
 * Separate from Contact on purpose. Contact routes a stranger's message to a
 * shared inbox; this collects a bug or an idea in the shape that makes it
 * actionable — a title, what happened, and where — and keeps a copy in the
 * feedback table so a feature request becomes a backlog rather than an email
 * someone has to remember. Open to anyone, because the person who has hit a bug
 * that stops them signing in is exactly who needs to tell us about it.
 */

export function meta() {
  return [
    { title: "Report a bug or request a feature — SprueTube" },
    {
      name: "description",
      content:
        "Found something broken on SprueTube, or got an idea to make it better? Tell us here — a person reads every one.",
    },
  ];
}

const PROMPTS: Record<
  FeedbackKind,
  { titlePlaceholder: string; bodyPlaceholder: string }
> = {
  bug: {
    titlePlaceholder: "Short summary — e.g. “Photos won’t upload on iPhone”",
    bodyPlaceholder:
      "What were you doing, what did you expect, and what happened instead? If you saw an error, paste it. The browser or phone you were on helps too.",
  },
  feature: {
    titlePlaceholder: "The idea in one line — e.g. “Filter the feed by scale”",
    bodyPlaceholder:
      "What would you like to be able to do, and why? What are you doing now instead? No idea is too small.",
  },
};

export default function Feedback() {
  const { viewer } = useRoot();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [website, setWebsite] = useState("");

  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Prefill "which page" with where they came from, when that was on the site.
  // Best-effort: same-origin referrers only, so nothing external leaks in.
  useEffect(() => {
    try {
      const ref = document.referrer;
      if (ref && new URL(ref).origin === window.location.origin) {
        setPageUrl(ref);
      }
    } catch {
      // No referrer, or an unparseable one — leave the field empty.
    }
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFields({});

    try {
      await api.post("/feedback", {
        kind,
        title: title.trim(),
        body: body.trim(),
        email: email.trim() || null,
        pageUrl: pageUrl.trim() || null,
        website,
      });
      setSent(true);
    } catch (caught) {
      setSubmitting(false);
      if (caught instanceof ApiError) {
        setFields(caught.fields ?? {});
        setError(caught.message);
      } else {
        setError("Could not reach the server. Check your connection.");
      }
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-2xl py-2">
        <div className="st-card p-6 text-center sm:p-8">
          <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
          <h1 className="mt-4 text-lg font-semibold">Got it — thank you</h1>
          <p className="st-text-muted mt-2 text-sm leading-relaxed">
            {kind === "bug"
              ? "Your report is logged and a person will take a look. If you left an email, we will only use it to follow up on this."
              : "Your idea is on the list. We read every one — the good ones shape what gets built next."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setTitle("");
                setBody("");
              }}
              className="st-btn st-btn-ghost"
            >
              Send another
            </button>
            <Link to="/" className="st-btn st-btn-primary">
              Back to the feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="text-2xl font-bold">Bugs &amp; ideas</h1>
      <p className="st-text-muted mt-2 text-[0.9375rem] leading-relaxed">
        Something broken, or something you wish the site did? Tell us here. A
        person reads every one — no bot, no ticket number.
      </p>

      <form onSubmit={onSubmit} className="st-card mt-5 space-y-4 p-4 sm:p-5">
        <fieldset>
          <legend className="st-label">What is this?</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {FEEDBACK_KINDS.map((value) => (
              <label
                key={value}
                className={[
                  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  kind === value
                    ? "st-raised st-text-strong"
                    : "st-text-muted hover:st-text-strong",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="accent-[var(--color-primer-500)]"
                />
                {value === "bug" ? "🐞" : "💡"} {FEEDBACK_KIND_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="title" className="st-label">
            Title
          </label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_FEEDBACK_TITLE}
            required
            className="st-input"
            placeholder={PROMPTS[kind].titlePlaceholder}
          />
          {fields.title ? <p className="st-error">{fields.title}</p> : null}
        </div>

        <div>
          <label htmlFor="body" className="st-label">
            {kind === "bug" ? "What happened?" : "Tell us more"}
          </label>
          <textarea
            id="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={7}
            maxLength={MAX_FEEDBACK_BODY}
            required
            className="st-input resize-y"
            placeholder={PROMPTS[kind].bodyPlaceholder}
          />
          <p className="st-text-muted mt-1 text-xs">
            {body.length}/{MAX_FEEDBACK_BODY}
          </p>
          {fields.body ? <p className="st-error">{fields.body}</p> : null}
        </div>

        {kind === "bug" ? (
          <div>
            <label htmlFor="pageUrl" className="st-label">
              Which page? (optional)
            </label>
            <input
              id="pageUrl"
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              maxLength={400}
              className="st-input"
              placeholder="The page where it went wrong"
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="st-label">
            Your email (optional)
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="email"
            className="st-input"
            placeholder={
              viewer
                ? "Only if you want a reply to a different address"
                : "Only if you want us to be able to reply"
            }
          />
          <p className="st-text-muted mt-1 text-xs">
            {viewer
              ? "You are signed in, so we know who you are — this is only for a reply."
              : "We only use it to reply about this. Leave it blank to stay anonymous."}
          </p>
          {fields.email ? <p className="st-error">{fields.email}</p> : null}
        </div>

        {/* Honeypot — hidden from people and screen readers, out of the tab
            order. Anything in it is a bot; the server accepts and drops it. */}
        <div aria-hidden className="hidden">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="submit"
            disabled={submitting}
            className="st-btn st-btn-primary w-full sm:w-auto"
          >
            {submitting ? "Sending…" : "Send it"}
          </button>
          <p className="st-text-muted text-xs">
            A safety problem instead?{" "}
            <Link to="/contact" className="st-link">
              Use Contact
            </Link>{" "}
            — it is read first. Or email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="st-link break-all">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </form>
    </div>
  );
}
