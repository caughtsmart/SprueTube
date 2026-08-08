import { useState } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/forgot-password";
import { AuthCard } from "../components/AuthCard";
import { getScope } from "../lib/data.server";

export function meta() {
  return [
    { title: "Reset your password — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (scope.viewer) throw redirect("/settings");
  return null;
}

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          redirectTo: "/reset-password",
        }),
      });

      // better-auth answers the same way whether or not the address exists, so
      // there is nothing here that distinguishes the two — which is the point.
      if (!response.ok) {
        setError("Something went wrong. Try again in a moment.");
        setSubmitting(false);
        return;
      }

      setSent(true);
    } catch {
      setError("Could not reach the server. Check your connection.");
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="If that address has an account, a reset link is on its way."
      >
        <p className="st-text-muted text-sm leading-relaxed">
          The link works once and expires in an hour. If nothing arrives within
          a few minutes, look in your spam folder — and check the address you
          typed, because we cannot tell you whether it matched.
        </p>
        <p className="st-text-muted mt-6 text-center text-sm">
          <Link to="/login" className="st-link font-medium">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will email you a link to set a new one."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="st-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className="st-input"
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="st-btn st-btn-primary w-full"
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="st-text-muted mt-6 text-center text-sm">
        Remembered it?{" "}
        <Link to="/login" className="st-link font-medium">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
