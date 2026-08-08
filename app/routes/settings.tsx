import { useState } from "react";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/settings";
import { Avatar } from "../components/Avatar";
import { api, ApiError, uploadImage } from "../lib/api";
import { getScope } from "../lib/data.server";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  MAX_BIO_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Settings — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/settings");

  /*
   * Somebody who only ever signed in with Google has no password to change.
   * Offering them a "current password" field they can never fill in is worse
   * than showing nothing, so ask the account table which kind they are.
   */
  const credential = await scope.db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, scope.viewer!.userId), eq(a.providerId, "credential")),
    columns: { id: true },
  });

  const { profile } = scope.viewer;
  return {
    hasPassword: Boolean(credential),
    profile: {
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio ?? "",
      location: profile.location ?? "",
      websiteUrl: profile.websiteUrl ?? "",
      pronouns: profile.pronouns ?? "",
      systems: profile.systems ?? [],
      avatarImageId: profile.avatarImageId,
    },
  };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();
  const [profile, setProfile] = useState(loaderData.profile);
  const [avatarUrl, setAvatarUrl] = useState(
    imageSrc(config, loaderData.profile.avatarImageId, "avatar"),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const { imageId } = await uploadImage(file, "avatar");
      await api.patch("/profile", { avatarImageId: imageId });
      setAvatarUrl(imageSrc(config, imageId, "avatar"));
    } catch {
      setError("Could not upload that image.");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      await api.patch("/profile", {
        displayName: profile.displayName,
        bio: profile.bio || null,
        location: profile.location || null,
        websiteUrl: profile.websiteUrl || null,
        pronouns: profile.pronouns || null,
        systems: profile.systems,
      });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (caught) {
      setStatus("idle");
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : "Could not save that.",
      );
    }
  }

  function toggleSystem(system: string) {
    setProfile((current) => {
      const has = current.systems.includes(system);
      if (has) {
        return {
          ...current,
          systems: current.systems.filter((s) => s !== system),
        };
      }
      // Six is enough to say what you paint without turning the profile into
      // a wall of tags.
      if (current.systems.length >= 6) return current;
      return { ...current, systems: [...current.systems, system] };
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Settings</h1>

      <form onSubmit={onSubmit} className="st-card space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <Avatar username={profile.username} src={avatarUrl} size={64} />
          <label className="st-btn st-btn-ghost cursor-pointer text-sm">
            Change photo
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={onAvatar}
            />
          </label>
        </div>

        <div>
          <label htmlFor="displayName" className="st-label">
            Display name
          </label>
          <input
            id="displayName"
            value={profile.displayName}
            onChange={(event) =>
              setProfile({ ...profile, displayName: event.target.value })
            }
            maxLength={50}
            className="st-input"
          />
        </div>

        <div>
          <label htmlFor="bio" className="st-label">
            Bio
          </label>
          <textarea
            id="bio"
            value={profile.bio}
            onChange={(event) =>
              setProfile({ ...profile, bio: event.target.value })
            }
            rows={3}
            maxLength={MAX_BIO_LENGTH}
            className="st-input resize-y"
          />
          <p className="st-text-muted mt-1 text-xs">
            {profile.bio.length}/{MAX_BIO_LENGTH}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="location" className="st-label">
              Location
            </label>
            <input
              id="location"
              value={profile.location}
              onChange={(event) =>
                setProfile({ ...profile, location: event.target.value })
              }
              maxLength={60}
              className="st-input"
              placeholder="South Wales"
            />
          </div>

          <div>
            <label htmlFor="pronouns" className="st-label">
              Pronouns
            </label>
            <input
              id="pronouns"
              value={profile.pronouns}
              onChange={(event) =>
                setProfile({ ...profile, pronouns: event.target.value })
              }
              maxLength={30}
              className="st-input"
              placeholder="they/them"
            />
          </div>
        </div>

        <div>
          <label htmlFor="websiteUrl" className="st-label">
            Link
          </label>
          <input
            id="websiteUrl"
            type="url"
            value={profile.websiteUrl}
            onChange={(event) =>
              setProfile({ ...profile, websiteUrl: event.target.value })
            }
            maxLength={200}
            className="st-input"
            placeholder="https://"
          />
        </div>

        <fieldset>
          <legend className="st-label">What do you paint or build?</legend>
          <div className="flex flex-wrap gap-1.5">
            {GAME_SYSTEMS.map((system) => {
              const active = profile.systems.includes(system);
              return (
                <button
                  key={system}
                  type="button"
                  onClick={() => toggleSystem(system)}
                  aria-pressed={active}
                  className={`st-chip ${
                    active
                      ? "border-[var(--color-primer-500)] text-[var(--color-primer-400)]"
                      : ""
                  }`}
                >
                  {GAME_SYSTEM_LABELS[system]}
                </button>
              );
            })}
          </div>
          <p className="st-text-muted mt-1.5 text-xs">
            Pick up to six. They show on your profile and help people find you.
          </p>
        </fieldset>

        {error ? <p className="st-error">{error}</p> : null}

        <div className="flex items-center justify-end gap-3">
          {status === "saved" ? (
            <span className="text-sm text-[var(--color-wash-400)]">Saved</span>
          ) : null}
          <button
            type="submit"
            disabled={status === "saving"}
            className="st-btn st-btn-primary"
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {loaderData.hasPassword ? <ChangePassword /> : null}

      <section className="st-card mt-5 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Your account</h2>
        <p className="st-text-muted mt-1 text-sm">
          You are signed in as @{profile.username}.
        </p>

        {loaderData.hasPassword ? null : (
          <p className="st-text-muted mt-2 text-sm">
            You sign in with Google, so there is no password on this account to
            change.
          </p>
        )}

        <Form method="post" action="/logout" className="mt-4">
          <button type="submit" className="st-btn st-btn-ghost">
            Sign out
          </button>
        </Form>
      </section>
    </div>
  );
}

/**
 * Change the password from inside the account.
 *
 * Distinct from the reset flow, which exists for people who cannot sign in at
 * all. This one is for the ordinary case — you know the old password and want a
 * different one — and it asks for the current password so that a borrowed
 * unlocked laptop cannot be used to take the account over.
 *
 * Every other session is revoked. better-auth issues this browser a fresh
 * cookie in the same response, so the person changing it stays signed in here
 * and is signed out everywhere else, which is what someone doing this after
 * losing a phone actually wants.
 */
function ChangePassword() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwords need to be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== String(data.get("confirm") ?? "")) {
      setError("Those two passwords do not match.");
      return;
    }

    setStatus("saving");

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(data.get("currentPassword") ?? ""),
          newPassword,
          revokeOtherSessions: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        setError(
          payload?.code === "INVALID_PASSWORD"
            ? "That current password is not right."
            : "Could not change the password. Try again in a moment.",
        );
        setStatus("idle");
        return;
      }

      form.reset();
      setStatus("saved");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setStatus("idle");
    }
  }

  return (
    <section className="st-card mt-5 p-4 sm:p-5">
      <h2 className="text-base font-semibold">Password</h2>
      <p className="st-text-muted mt-1 text-sm">
        Changing it signs you out on every other device.
      </p>

      <form onSubmit={onSubmit} className="mt-4 max-w-sm space-y-4">
        <div>
          <label htmlFor="currentPassword" className="st-label">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="st-input"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="st-label">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="st-input"
          />
          <p className="st-text-muted mt-1 text-xs">
            At least {MIN_PASSWORD_LENGTH} characters.
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

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === "saving"}
            className="st-btn st-btn-primary"
          >
            {status === "saving" ? "Changing…" : "Change password"}
          </button>
          {status === "saved" ? (
            <span className="text-sm text-[var(--color-wash-400)]">
              Password changed
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
