import { useState } from "react";
import { Link, redirect, useNavigate } from "react-router";
import type { Route } from "./+types/signup";
import { AuthCard, OAuthButtons } from "../components/AuthCard";
import { getScope } from "../lib/data.server";

export function meta() {
  return [
    { title: "Create an account — SprueTube" },
    {
      name: "description",
      content:
        "Join SprueTube and share what is on your workbench with other miniature painters and model makers.",
    },
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

export default function Signup({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    if (password.length < 10) {
      setError("Passwords need to be at least 10 characters.");
      setSubmitting(false);
      return;
    }

    try {
      // better-auth owns these endpoints; the app never handles a password
      // beyond posting it straight to them over HTTPS.
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: name || email.split("@")[0] }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? "Could not create that account.");
        setSubmitting(false);
        return;
      }

      // Straight into onboarding: a username and an age check are still needed
      // before this account can post anything.
      navigate("/welcome");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Get on the sprue"
      subtitle="An account takes about twenty seconds."
    >
      <OAuthButtons
        googleEnabled={loaderData.googleEnabled}
        appleEnabled={loaderData.appleEnabled}
        action="Sign up"
      />

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="st-label">
            Name
          </label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            className="st-input"
            placeholder="What people should call you"
          />
        </div>

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
            minLength={10}
            autoComplete="new-password"
            className="st-input"
          />
          <p className="st-text-muted mt-1 text-xs">
            At least 10 characters. A short sentence beats a clever word.
          </p>
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="st-btn st-btn-primary w-full"
        >
          {submitting ? "Creating your account…" : "Create account"}
        </button>

        <p className="st-text-muted text-xs leading-relaxed">
          By joining you agree to the{" "}
          <Link to="/terms" className="st-link">
            terms
          </Link>{" "}
          and the{" "}
          <Link to="/rules" className="st-link">
            community rules
          </Link>
          . You need to be 13 or over. We explain what we do with your data in
          the{" "}
          <Link to="/privacy" className="st-link">
            privacy notice
          </Link>
          .
        </p>
      </form>

      <p className="st-text-muted mt-6 text-center text-sm">
        Already here?{" "}
        <Link to="/login" className="st-link font-medium">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
