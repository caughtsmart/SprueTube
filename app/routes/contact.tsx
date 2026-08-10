import { useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api";
import { useRoot } from "../root";
import { CONTACT_EMAIL, operatorLine } from "../lib/legal";
import { CONTACT_TOPICS, CONTACT_TOPIC_LABELS } from "../lib/taxonomy";

/*
 * The way in that the site pushes people towards, and the one it can route.
 *
 * `hello@spruetube.app` is published beside it because the law requires an
 * address — see the note on CONTACT_EMAIL in app/lib/legal.ts — and because a
 * form is no use to someone whose message just failed to send. It is a role
 * address forwarded by Email Routing; no personal address appears anywhere on
 * the site.
 *
 * The form still earns its place: it collects a topic, which is what lets a
 * shared inbox put a safety report in front of a question about postage.
 */

export function meta() {
  return [
    { title: "Contact — SprueTube" },
    {
      name: "description",
      content:
        "Get in touch with the people who run SprueTube — general enquiries, account help, bug reports, advertising and press.",
    },
  ];
}

export default function Contact() {
  const { viewer } = useRoot();

  const [topic, setTopic] = useState<string>("general");
  // Prefilled for anyone signed in, and still editable — the address they want
  // a reply at is not always the one on the account.
  const [name, setName] = useState(viewer?.displayName ?? "");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");

  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFields({});

    try {
      await api.post("/contact", {
        topic,
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
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
          <div
            aria-hidden
            className="st-hazard mx-auto h-2.5 w-32 rounded-sm"
          />
          <h1 className="mt-4 text-lg font-semibold">That is with us</h1>
          <p className="st-text-muted mt-2 text-sm leading-relaxed">
            A person reads these — there is no ticket system and no bot in the
            middle. Expect a reply to{" "}
            <span className="st-text-strong break-all">{email}</span> within a couple of
            working days.
          </p>
          <Link to="/" className="st-btn st-btn-ghost mt-6">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="text-2xl font-bold">Contact</h1>
      <p className="st-text-muted mt-2 text-[0.9375rem] leading-relaxed">
        SprueTube is run by a small team at a hobby shop in South Wales, not a
        support department. Write in plain English and someone will answer.
      </p>

      {/*
        Two topics carry a clock, and both used to have their own address.
        Now that everything arrives here, the panel's job is the opposite of
        what it was: not to send them away, but to make sure they pick the
        topic that gets them read first.
      */}
      <div className="st-well mt-5 rounded-md p-3">
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="st-hazard-tag" />
          <h2 className="text-sm font-medium">Two of these jump the queue</h2>
        </div>
        <ul className="st-text-muted space-y-1.5 text-sm">
          <li>
            Something unsafe, or a moderation appeal — picked from the list
            below, it is read before anything else. How that works is on the{" "}
            <Link to="/safety" className="st-link">
              safety page
            </Link>
            . For one particular post or comment, the{" "}
            <strong className="st-text-strong">⋯ → Report</strong> menu on it is
            faster than this form and tells us exactly what you mean.
          </li>
          <li>
            Your data — a copy, a correction, or deletion. Choose that topic and
            the month we have to answer in starts the moment it arrives, as set
            out in the{" "}
            <Link to="/privacy" className="st-link">
              privacy notice
            </Link>
            .
          </li>
        </ul>
      </div>

      <form onSubmit={onSubmit} className="st-card mt-5 space-y-4 p-4 sm:p-5">
        <div>
          <label htmlFor="topic" className="st-label">
            What is it about?
          </label>
          <select
            id="topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="st-input"
          >
            {CONTACT_TOPICS.map((value) => (
              <option key={value} value={value}>
                {CONTACT_TOPIC_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="st-label">
              Your name
            </label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoComplete="name"
              className="st-input"
            />
            {fields.name ? <p className="st-error">{fields.name}</p> : null}
          </div>

          <div>
            <label htmlFor="email" className="st-label">
              Your email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
              autoComplete="email"
              className="st-input"
            />
            <p className="st-text-muted mt-1 text-xs">
              Only used to reply to you.
            </p>
            {fields.email ? <p className="st-error">{fields.email}</p> : null}
          </div>
        </div>

        <div>
          <label htmlFor="message" className="st-label">
            Message
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={7}
            maxLength={4000}
            required
            className="st-input resize-y"
            placeholder="If it is a bug, tell us what you were doing and what happened instead. A screenshot helps — say so and we will ask for one."
          />
          <p className="st-text-muted mt-1 text-xs">
            {message.length}/4000
          </p>
          {fields.message ? (
            <p className="st-error">{fields.message}</p>
          ) : null}
        </div>

        {/*
          Honeypot. Hidden from people with CSS and from screen readers with
          aria-hidden, and left out of the tab order — so nobody using the site
          in any ordinary way can fill it in, and the bots that fill in every
          input on a page announce themselves by doing it.
        */}
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
            {submitting ? "Sending…" : "Send message"}
          </button>
          <p className="st-text-muted text-xs">
            Or email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="st-link break-all">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </form>

      <p className="st-text-muted mt-5 text-xs leading-relaxed">
        SprueTube is operated by {operatorLine()}.
      </p>
    </div>
  );
}
