import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useRoot } from "../root";

/**
 * Save and fork controls for a recipe, shown to anyone who is not its owner.
 *
 * Save keeps it in your collection; fork copies it into one you own and drops
 * you in the editor to make it yours. Signed-out visitors are sent to sign in
 * and back — the controls are the reason to have an account, so they are shown,
 * not hidden.
 */
export function RecipeActions({
  recipeId,
  path,
  initialSaved,
  saveCount,
}: {
  recipeId: string;
  /** This recipe's URL, for the sign-in round trip. */
  path: string;
  initialSaved: boolean;
  saveCount: number;
}) {
  const { viewer } = useRoot();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(initialSaved);
  const [count, setCount] = useState(saveCount);
  const [busy, setBusy] = useState(false);

  function requireSignIn() {
    navigate(`/login?next=${encodeURIComponent(path)}`);
  }

  async function toggleSave() {
    if (!viewer) return requireSignIn();
    setBusy(true);
    try {
      if (saved) {
        await api.delete(`/recipes/${recipeId}/save`);
        setSaved(false);
        setCount((current) => Math.max(0, current - 1));
      } else {
        await api.post(`/recipes/${recipeId}/save`);
        setSaved(true);
        setCount((current) => current + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function fork() {
    if (!viewer) return requireSignIn();
    setBusy(true);
    try {
      const created = await api.post<{ id: string; slug: string }>(
        `/recipes/${recipeId}/fork`,
      );
      // Land in the editor of the new copy, ready to make it theirs.
      navigate(`/@${viewer.username}/recipes/${created.slug}/edit`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={toggleSave}
        disabled={busy}
        aria-pressed={saved}
        className={`st-btn text-sm ${saved ? "st-btn-primary" : "st-btn-ghost"}`}
      >
        {saved ? "Saved" : "Save"}
        {count > 0 ? ` · ${count}` : ""}
      </button>
      <button
        type="button"
        onClick={fork}
        disabled={busy}
        className="st-btn st-btn-ghost text-sm"
        title="Copy this into a recipe you can edit"
      >
        Fork
      </button>
    </div>
  );
}
