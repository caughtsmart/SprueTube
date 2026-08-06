import { useState } from "react";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/settings";
import { Avatar } from "../components/Avatar";
import { api, ApiError, uploadImage } from "../lib/api";
import { getScope } from "../lib/data.server";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS, MAX_BIO_LENGTH } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Settings — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/settings");

  const { profile } = scope.viewer;
  return {
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

      <section className="st-card mt-5 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Your account</h2>
        <p className="st-text-muted mt-1 text-sm">
          You are signed in as @{profile.username}.
        </p>

        <Form method="post" action="/logout" className="mt-4">
          <button type="submit" className="st-btn st-btn-ghost">
            Sign out
          </button>
        </Form>
      </section>
    </div>
  );
}
