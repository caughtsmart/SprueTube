import { useEffect, useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/onboarding";
import { AuthCard } from "../components/AuthCard";
import { api, ApiError } from "../lib/api";
import { getScope } from "../lib/data.server";

export function meta() {
  return [
    { title: "Set up your profile — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/welcome");
  if (scope.viewer.profile.birthdate) throw redirect("/");

  return {
    suggestedUsername: scope.viewer.profile.username,
    suggestedName: scope.viewer.profile.displayName,
  };
}

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loaderData.suggestedUsername);
  const [available, setAvailable] = useState<null | {
    ok: boolean;
    reason: string | null;
  }>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Debounced availability check. 400ms is long enough not to fire on every
  // keystroke and short enough that the answer is there before they tab away.
  useEffect(() => {
    if (username.length < 3) {
      setAvailable(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean; reason: string | null }>(
          `/usernames/${encodeURIComponent(username)}/available`,
        );
        setAvailable({ ok: result.available, reason: result.reason });
      } catch {
        setAvailable(null);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [username]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);

    try {
      await api.post("/onboarding", {
        username,
        displayName: String(form.get("displayName") ?? "").trim(),
        birthdate: String(form.get("birthdate") ?? ""),
        bio: String(form.get("bio") ?? "").trim() || null,
      });
      navigate("/");
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFields(caught.fields ?? {});
        setError(caught.fields ? null : caught.message);
      } else {
        setError("Could not save that. Try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Nearly there"
      subtitle="Pick a name people will know you by."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="username" className="st-label">
            Username
          </label>
          <div className="flex items-center gap-2">
            <span className="st-text-muted text-sm">@</span>
            <input
              id="username"
              name="username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
              }
              required
              minLength={3}
              maxLength={20}
              className="st-input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {fields.username ? (
            <p className="st-error">{fields.username}</p>
          ) : available ? (
            <p
              className={
                available.ok
                  ? "mt-1 text-xs text-[var(--color-wash-400)]"
                  : "st-error"
              }
            >
              {available.ok ? "That one is free." : available.reason}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="displayName" className="st-label">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={loaderData.suggestedName}
            required
            maxLength={50}
            className="st-input"
          />
          {fields.displayName ? (
            <p className="st-error">{fields.displayName}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="birthdate" className="st-label">
            Date of birth
          </label>
          <input
            id="birthdate"
            name="birthdate"
            type="date"
            required
            className="st-input"
          />
          <p className="st-text-muted mt-1 text-xs">
            SprueTube is for people aged 13 and over. We use this once to check
            that and never show it on your profile.
          </p>
          {fields.birthdate ? (
            <p className="st-error">{fields.birthdate}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="bio" className="st-label">
            Bio <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            maxLength={280}
            className="st-input resize-y"
            placeholder="What do you paint? How long have you been at it?"
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting || available?.ok === false}
          className="st-btn st-btn-primary w-full"
        >
          {submitting ? "Saving…" : "Start posting"}
        </button>
      </form>
    </AuthCard>
  );
}
