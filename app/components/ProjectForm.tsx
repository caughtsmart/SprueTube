import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, uploadImage } from "../lib/api";
import { imageSrc, type MediaConfig } from "../lib/media";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  MAX_PROJECT_SUMMARY_LENGTH,
  MAX_PROJECT_TITLE_LENGTH,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  SCALES,
  type ProjectStatus,
} from "../lib/taxonomy";

export type ProjectDraft = {
  title: string;
  summary: string;
  gameSystem: string;
  scale: string;
  status: ProjectStatus;
  coverImageId: string | null;
};

export const EMPTY_PROJECT: ProjectDraft = {
  title: "",
  summary: "",
  gameSystem: "",
  scale: "",
  status: "active",
  coverImageId: null,
};

/**
 * Create or edit a build log.
 *
 * One component for both, because the fields are identical and the only real
 * differences are the verb on the button and where it goes afterwards. Two
 * copies of a form drift in exactly the way that leaves one of them missing a
 * field nobody notices for months.
 */
export function ProjectForm({
  config,
  initial,
  projectId,
  username,
}: {
  config: MediaConfig;
  initial: ProjectDraft;
  /** Set when editing. Absent means create. */
  projectId?: string;
  /** Where to go afterwards. */
  username: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [coverUrl, setCoverUrl] = useState(
    imageSrc(config, initial.coverImageId, "feed"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(projectId);

  async function onCover(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const { imageId } = await uploadImage(file, "cover");
      setDraft((current) => ({ ...current, coverImageId: imageId }));
      setCoverUrl(imageSrc(config, imageId, "feed"));
    } catch {
      setError("Could not upload that image.");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) {
      setError("A build log needs a name.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload = {
      title: draft.title.trim(),
      summary: draft.summary.trim() || null,
      gameSystem: draft.gameSystem || null,
      scale: draft.scale || null,
      status: draft.status,
      coverImageId: draft.coverImageId,
    };

    try {
      if (projectId) {
        await api.patch(`/projects/${projectId}`, payload);
        navigate(`/@${username}`);
      } else {
        const created = await api.post<{ id: string; slug: string }>(
          "/projects",
          payload,
        );
        navigate(`/@${username}/projects/${created.slug}`);
      }
    } catch (caught) {
      setSubmitting(false);
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : "Could not save that.",
      );
    }
  }

  async function onDelete() {
    // The posts survive — the foreign key sets their project to null rather
    // than cascading. Say so plainly, because "delete" on a page full of
    // someone's photographs reads as though it takes the photographs.
    const ok = window.confirm(
      "Delete this build log? The posts in it stay on your profile — they just stop being grouped.",
    );
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/projects/${projectId}`);
      navigate(`/@${username}`);
    } catch {
      setDeleting(false);
      setError("Could not delete that.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-card space-y-4 p-4 sm:p-5">
      <div>
        <label htmlFor="title" className="st-label">
          Name
        </label>
        <input
          id="title"
          value={draft.title}
          onChange={(event) =>
            setDraft({ ...draft, title: event.target.value })
          }
          maxLength={MAX_PROJECT_TITLE_LENGTH}
          required
          autoFocus={!editing}
          className="st-input"
          placeholder="Death Guard kill team"
        />
      </div>

      <div>
        <label htmlFor="summary" className="st-label">
          What is it?
        </label>
        <textarea
          id="summary"
          value={draft.summary}
          onChange={(event) =>
            setDraft({ ...draft, summary: event.target.value })
          }
          rows={3}
          maxLength={MAX_PROJECT_SUMMARY_LENGTH}
          className="st-input resize-y"
          placeholder="Slowly rusting my way through a Plague Marine squad. Mostly an excuse to try sponge chipping."
        />
        <p className="st-text-muted mt-1 text-xs">
          {draft.summary.length}/{MAX_PROJECT_SUMMARY_LENGTH}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="gameSystem" className="st-label">
            System
          </label>
          <select
            id="gameSystem"
            value={draft.gameSystem}
            onChange={(event) =>
              setDraft({ ...draft, gameSystem: event.target.value })
            }
            className="st-input"
          >
            <option value="">Not set</option>
            {GAME_SYSTEMS.map((system) => (
              <option key={system} value={system}>
                {GAME_SYSTEM_LABELS[system]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="scale" className="st-label">
            Scale
          </label>
          <select
            id="scale"
            value={draft.scale}
            onChange={(event) =>
              setDraft({ ...draft, scale: event.target.value })
            }
            className="st-input"
          >
            <option value="">Not set</option>
            {SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {scale}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="status" className="st-label">
            Status
          </label>
          <select
            id="status"
            value={draft.status}
            onChange={(event) =>
              setDraft({
                ...draft,
                status: event.target.value as ProjectStatus,
              })
            }
            className="st-input"
          >
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="st-label">Cover image</span>
        <div className="mt-1 flex items-center gap-3">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="h-16 w-28 rounded-lg object-cover"
            />
          ) : (
            <div className="st-text-muted flex h-16 w-28 items-center justify-center rounded-lg border border-dashed text-xs">
              None
            </div>
          )}
          <label className="st-btn st-btn-ghost cursor-pointer text-sm">
            {coverUrl ? "Change" : "Add one"}
            <input type="file" accept="image/*" hidden onChange={onCover} />
          </label>
        </div>
      </div>

      {error ? <p className="st-error">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="st-btn st-btn-primary"
        >
          {submitting
            ? "Saving…"
            : editing
              ? "Save changes"
              : "Create build log"}
        </button>

        <Link to={`/@${username}`} className="st-btn st-btn-ghost">
          Cancel
        </Link>

        {editing ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting || deleting}
            className="st-btn st-btn-ghost ml-auto text-sm text-[#ff8080]"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
