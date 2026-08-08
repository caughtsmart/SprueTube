import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthCard } from "../components/AuthCard";
import { MIN_PASSWORD_LENGTH } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Choose a new password — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

/*
 * Where the emailed link lands.
 *
 * The link in the email points at better-auth, not here: it checks the token
 * has not expired and only then redirects to this page with `?token=`. So a
 * stale link never reaches the form — it arrives with `?error=INVALID_TOKEN`
 * instead, and we say so rather than letting someone type a new password twice
 * and watch it fail on submit.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const token = searchParams.get("token");
  const linkError = searchParams.get("error");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwords need to be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== String(form.get("confirm") ?? "")) {
      setError("Those two passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });

      if (!response.ok) {
        setError(
          "That link has expired or has already been used. Ask for a new one.",
        );
        setSubmitting(false);
        return;
      }

      // The password is changed but no session is created, and every old
      // session was just revoked — so there is nowhere to go but sign-in.
      navigate("/login?reset=1");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setSubmitting(false);
    }
  }

  if (!token || linkError) {
    return (
      <AuthCard
        title="That link no longer works"
        subtitle="Reset links last an hour and can only be used once."
      >
        <p className="st-text-muted text-sm leading-relaxed">
          Ask for a fresh one and it will arrive in a minute or two.
        </p>
        <Link
          to="/forgot-password"
          className="st-btn st-btn-primary mt-5 w-full"
        >
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="This signs you out everywhere else."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="st-label">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            autoFocus
            className="st-input"
          />
          <p className="st-text-muted mt-1 text-xs">
            At least {MIN_PASSWORD_LENGTH} characters. A short sentence beats a
            clever word.
          </p>
        </div>

        <div>
          <label htmlFor="confirm" className="st-label">
            Confirm new password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="st-input"
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="st-btn st-btn-primary w-full"
        >
          {submitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthCard>
  );
}
