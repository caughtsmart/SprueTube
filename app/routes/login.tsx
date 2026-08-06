import { useState } from "react";
import { Link, redirect, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { AuthCard, OAuthButtons } from "../components/AuthCard";
import { getScope } from "../lib/data.server";

export function meta() {
  return [
    { title: "Sign in — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (scope.viewer) throw redirect("/");

  return {
    googleEnabled: Boolean(scope.env.GOOGLE_CLIENT_ID),
    appleEnabled: Boolean(scope.env.APPLE_CLIENT_ID),
  };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only ever redirect to a path on this site. An open redirect on a login
  // page is a phishing gift.
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });

      if (!response.ok) {
        // Deliberately vague: saying which half was wrong tells an attacker
        // which addresses have accounts.
        setError("That email and password did not match.");
        setSubmitting(false);
        return;
      }

      navigate(next);
    } catch {
      setError("Could not reach the server. Check your connection.");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Pick up where you left off.">
      <OAuthButtons
        googleEnabled={loaderData.googleEnabled}
        appleEnabled={loaderData.appleEnabled}
        action="Sign in"
      />

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
            className="st-input"
          />
        </div>

        <div>
          <label htmlFor="password" className="st-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="st-input"
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="st-btn st-btn-primary w-full"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="st-text-muted mt-6 text-center text-sm">
        No account yet?{" "}
        <Link to="/signup" className="st-link font-medium">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
