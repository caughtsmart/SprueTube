import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  MAX_RECIPE_SUMMARY,
  MAX_RECIPE_TITLE,
  MAX_STEP_NOTE,
  MAX_STEP_PRODUCT_NAME,
  MAX_STEPS_PER_RECIPE,
  SCALES,
  TECHNIQUES,
  TECHNIQUE_LABELS,
  type Technique,
} from "../lib/taxonomy";

export type RecipeStepDraft = {
  technique: Technique;
  productName: string;
  brand: string;
  note: string;
};

export type RecipeDraft = {
  title: string;
  summary: string;
  gameSystem: string;
  scale: string;
  visibility: "public" | "unlisted" | "private";
  steps: RecipeStepDraft[];
};

const emptyStep = (): RecipeStepDraft => ({
  technique: "base",
  productName: "",
  brand: "",
  note: "",
});

export const EMPTY_RECIPE: RecipeDraft = {
  title: "",
  summary: "",
  gameSystem: "",
  scale: "",
  visibility: "public",
  steps: [emptyStep()],
};

const VISIBILITY_LABELS: Record<RecipeDraft["visibility"], string> = {
  public: "Public — anyone can find it",
  unlisted: "Unlisted — only people with the link",
  private: "Private — only you",
};

/**
 * Create or edit a recipe. One component for both, like ProjectForm — the
 * fields are identical and the only differences are the verb and where it goes
 * afterwards.
 */
export function RecipeForm({
  initial,
  recipeId,
  slug,
  username,
}: {
  initial: RecipeDraft;
  /** Set when editing. Absent means create. */
  recipeId?: string;
  /** The existing slug, so an edit navigates back to the same page. */
  slug?: string;
  username: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(recipeId);

  function setStep(index: number, patch: Partial<RecipeStepDraft>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      ),
    }));
  }

  function addStep() {
    setDraft((current) =>
      current.steps.length >= MAX_STEPS_PER_RECIPE
        ? current
        : { ...current, steps: [...current.steps, emptyStep()] },
    );
  }

  function removeStep(index: number) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, i) => i !== index),
    }));
  }

  function moveStep(index: number, delta: number) {
    setDraft((current) => {
      const next = index + delta;
      if (next < 0 || next >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[next]] = [steps[next]!, steps[index]!];
      return { ...current, steps };
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) {
      setError("A recipe needs a name.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload = {
      title: draft.title.trim(),
      summary: draft.summary.trim() || null,
      gameSystem: draft.gameSystem || null,
      scale: draft.scale || null,
      visibility: draft.visibility,
      // A step with nothing in it — no paint and no note — is dropped rather
      // than saved as an empty row.
      steps: draft.steps
        .filter((step) => step.productName.trim() || step.note.trim())
        .map((step) => ({
          technique: step.technique,
          productName: step.productName.trim() || null,
          brand: step.brand.trim() || null,
          note: step.note.trim() || null,
        })),
    };

    try {
      if (recipeId) {
        await api.patch(`/recipes/${recipeId}`, payload);
        navigate(`/@${username}/recipes/${slug}`);
      } else {
        const created = await api.post<{ id: string; slug: string }>(
          "/recipes",
          payload,
        );
        navigate(`/@${username}/recipes/${created.slug}`);
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
    const ok = window.confirm("Delete this recipe? This cannot be undone.");
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/recipes/${recipeId}`);
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
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          maxLength={MAX_RECIPE_TITLE}
          required
          autoFocus={!editing}
          className="st-input"
          placeholder="Death Guard rust"
        />
      </div>

      <div>
        <label htmlFor="summary" className="st-label">
          What is it for?
        </label>
        <textarea
          id="summary"
          value={draft.summary}
          onChange={(event) =>
            setDraft({ ...draft, summary: event.target.value })
          }
          rows={2}
          maxLength={MAX_RECIPE_SUMMARY}
          className="st-input resize-y"
          placeholder="The chipped, rusted metal on my Plague Marines."
        />
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
            onChange={(event) => setDraft({ ...draft, scale: event.target.value })}
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
          <label htmlFor="visibility" className="st-label">
            Who can see it
          </label>
          <select
            id="visibility"
            value={draft.visibility}
            onChange={(event) =>
              setDraft({
                ...draft,
                visibility: event.target.value as RecipeDraft["visibility"],
              })
            }
            className="st-input"
          >
            {(["public", "unlisted", "private"] as const).map((value) => (
              <option key={value} value={value}>
                {VISIBILITY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="st-label">Steps</span>
          <span className="st-text-muted text-xs">
            {draft.steps.length}/{MAX_STEPS_PER_RECIPE}
          </span>
        </div>

        <ol className="space-y-3">
          {draft.steps.map((step, index) => (
            <li key={index} className="st-border rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Step ${index + 1} technique`}
                  value={step.technique}
                  onChange={(event) =>
                    setStep(index, {
                      technique: event.target.value as Technique,
                    })
                  }
                  className="st-input w-auto"
                >
                  {TECHNIQUES.map((technique) => (
                    <option key={technique} value={technique}>
                      {TECHNIQUE_LABELS[technique]}
                    </option>
                  ))}
                </select>

                <input
                  aria-label={`Step ${index + 1} brand`}
                  value={step.brand}
                  onChange={(event) =>
                    setStep(index, { brand: event.target.value })
                  }
                  maxLength={60}
                  className="st-input w-28"
                  placeholder="Brand"
                />
                <input
                  aria-label={`Step ${index + 1} paint`}
                  value={step.productName}
                  onChange={(event) =>
                    setStep(index, { productName: event.target.value })
                  }
                  maxLength={MAX_STEP_PRODUCT_NAME}
                  className="st-input min-w-0 flex-1"
                  placeholder="Paint (e.g. Ryza Rust)"
                />

                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    aria-label="Move step up"
                    className="st-btn st-btn-ghost px-2 text-sm disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === draft.steps.length - 1}
                    aria-label="Move step down"
                    className="st-btn st-btn-ghost px-2 text-sm disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    aria-label="Remove step"
                    className="st-btn st-btn-ghost px-2 text-sm text-[var(--color-error)]"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <input
                aria-label={`Step ${index + 1} note`}
                value={step.note}
                onChange={(event) => setStep(index, { note: event.target.value })}
                maxLength={MAX_STEP_NOTE}
                className="st-input mt-2"
                placeholder="Note — thinned 2:1, stipple with a sponge…"
              />
            </li>
          ))}
        </ol>

        {draft.steps.length < MAX_STEPS_PER_RECIPE ? (
          <button
            type="button"
            onClick={addStep}
            className="st-btn st-btn-ghost mt-3 text-sm"
          >
            + Add a step
          </button>
        ) : null}
      </div>

      {error ? <p className="st-error">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="st-btn st-btn-primary"
        >
          {submitting ? "Saving…" : editing ? "Save changes" : "Create recipe"}
        </button>

        <Link to={`/@${username}`} className="st-btn st-btn-ghost">
          Cancel
        </Link>

        {editing ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting || deleting}
            className="st-btn st-btn-ghost ml-auto text-sm text-[var(--color-error)]"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
