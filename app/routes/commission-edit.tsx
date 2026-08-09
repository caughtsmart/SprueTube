import { useState } from "react";
import { data, Link, redirect, useNavigate } from "react-router";
import type { Route } from "./+types/commission-edit";
import { api, ApiError, uploadImage } from "../lib/api";
import { getScope } from "../lib/data.server";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { getCommission } from "../../server/services/commissions";
import {
  formatPence,
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  MAX_COMMISSION_BLURB_LENGTH,
  MAX_COMMISSION_TITLE_LENGTH,
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  type PriceUnit,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [
    {
      title: loaded?.commissionId
        ? "Edit your listing — SprueTube"
        : "List your service — SprueTube",
    },
    { name: "robots", content: "noindex" },
  ];
}

const MAX_SYSTEMS = 6;

type Draft = {
  title: string;
  blurb: string;
  priceFrom: string;
  priceTo: string;
  priceUnit: PriceUnit;
  turnaroundDays: string;
  gameSystems: string[];
  location: string;
  coverImageId: string | null;
  openToWork: boolean;
};

const EMPTY: Draft = {
  title: "",
  blurb: "",
  priceFrom: "",
  priceTo: "",
  priceUnit: "model",
  turnaroundDays: "",
  gameSystems: [],
  location: "",
  coverImageId: null,
  openToWork: true,
};

/**
 * Pence back into the pounds the form shows.
 *
 * `formatPence` gives "£12.50"; the input wants "12.50". Stripping the sign
 * here rather than storing pounds anywhere keeps pence the only representation
 * that ever touches the database.
 */
function poundsField(pence: number | null): string {
  const formatted = formatPence(pence);
  return formatted ? formatted.replace("£", "") : "";
}

/*
 * One route module behind two URLs: /commissions/new and
 * /commissions/:username/:slug/edit. The fields are identical, and two copies
 * of a form is how one of them ends up quietly missing a field.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) {
    throw redirect(`/login?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  }

  const username = "username" in params ? params.username : undefined;
  const slug = "slug" in params ? params.slug : undefined;

  if (!username || !slug) {
    return {
      commissionId: null as string | null,
      username: scope.viewer.profile.username,
      draft: EMPTY,
      coverUrl: null as string | null,
    };
  }

  const found = await getCommission(scope.db, username, slug, scope.viewer.userId);
  /*
   * Ownership comes from the session, never from the handle in the URL. A
   * listing someone else owns is a 404 here rather than a 403 — there is no
   * reason to confirm that /commissions/someone/their-slug/edit is a real page
   * to somebody who cannot use it.
   */
  if (!found || !found.isOwner) {
    throw data({ message: "That listing is not yours." }, { status: 404 });
  }

  const row = found.commission;
  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };

  return {
    commissionId: row.id as string | null,
    username: found.owner.username,
    draft: {
      title: row.title,
      blurb: row.blurb,
      priceFrom: poundsField(row.priceFromPence),
      priceTo: poundsField(row.priceToPence),
      priceUnit: row.priceUnit as PriceUnit,
      turnaroundDays: row.turnaroundDays ? String(row.turnaroundDays) : "",
      gameSystems: row.gameSystems ?? [],
      location: row.location ?? "",
      coverImageId: row.coverImageId,
      openToWork: row.openToWork,
    } satisfies Draft,
    coverUrl: imageSrc(config, row.coverImageId, "feed"),
  };
}

export default function CommissionEdit({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft>(loaderData.draft);
  const [coverUrl, setCoverUrl] = useState(loaderData.coverUrl);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(loaderData.commissionId);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleSystem(system: string) {
    setDraft((current) => {
      if (current.gameSystems.includes(system)) {
        return {
          ...current,
          gameSystems: current.gameSystems.filter((s) => s !== system),
        };
      }
      if (current.gameSystems.length >= MAX_SYSTEMS) return current;
      return { ...current, gameSystems: [...current.gameSystems, system] };
    });
  }

  async function onCover(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const { imageId } = await uploadImage(file, "cover");
      update("coverImageId", imageId);
      setCoverUrl(imageSrc(config, imageId, "feed"));
    } catch {
      setError("Could not upload that image.");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFields({});
    setError(null);

    /*
     * The prices go up as the strings the painter typed. The server owns the
     * pounds-to-pence conversion so there is one implementation of it rather
     * than two that disagree about "12.5" — and it is the server's answer that
     * gets stored, so it had better be the server's arithmetic.
     */
    const payload = {
      title: draft.title,
      blurb: draft.blurb,
      priceFrom: draft.priceFrom,
      priceTo: draft.priceTo,
      priceUnit: draft.priceUnit,
      turnaroundDays: draft.turnaroundDays,
      gameSystems: draft.gameSystems,
      location: draft.location,
      coverImageId: draft.coverImageId,
      openToWork: draft.openToWork,
    };

    try {
      if (loaderData.commissionId) {
        const saved = await api.patch<{ slug: string }>(
          `/commissions/${loaderData.commissionId}`,
          payload,
        );
        void navigate(`/commissions/${loaderData.username}/${saved.slug}`);
      } else {
        const created = await api.post<{ slug: string; username: string }>(
          "/commissions",
          payload,
        );
        void navigate(`/commissions/${created.username}/${created.slug}`);
      }
    } catch (caught) {
      setSaving(false);
      if (caught instanceof ApiError && caught.fields) {
        setFields(caught.fields);
        setError("Check the highlighted fields.");
      } else {
        setError(
          caught instanceof ApiError ? caught.message : "Could not save that.",
        );
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">
        {editing ? "Edit your listing" : "List your service"}
      </h1>

      <form onSubmit={onSubmit} className="st-card space-y-4 p-4 sm:p-5">
        <div>
          <label htmlFor="title" className="st-label">
            What are you offering?
          </label>
          <input
            id="title"
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
            maxLength={MAX_COMMISSION_TITLE_LENGTH}
            required
            autoFocus={!editing}
            className="st-input"
            placeholder="Tabletop-plus 40K infantry"
          />
          {fields.title ? <p className="st-error">{fields.title}</p> : null}
        </div>

        <div>
          <label htmlFor="blurb" className="st-label">
            How you work
          </label>
          <textarea
            id="blurb"
            value={draft.blurb}
            onChange={(event) => update("blurb", event.target.value)}
            rows={6}
            maxLength={MAX_COMMISSION_BLURB_LENGTH}
            required
            className="st-input resize-y"
            placeholder="Airbrushed base coats, edge highlights, transfers and a simple textured base. I work in batches of ten and send photos at each stage."
          />
          <p className="st-text-muted mt-1 text-xs">
            {draft.blurb.length}/{MAX_COMMISSION_BLURB_LENGTH}
          </p>
          {fields.blurb ? <p className="st-error">{fields.blurb}</p> : null}
        </div>

        <fieldset>
          <legend className="st-label">Price</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="priceFrom" className="st-text-muted text-xs">
                From (£)
              </label>
              <input
                id="priceFrom"
                value={draft.priceFrom}
                onChange={(event) => update("priceFrom", event.target.value)}
                inputMode="decimal"
                className="st-input mt-1"
                placeholder="12"
              />
            </div>
            <div>
              <label htmlFor="priceTo" className="st-text-muted text-xs">
                To (£)
              </label>
              <input
                id="priceTo"
                value={draft.priceTo}
                onChange={(event) => update("priceTo", event.target.value)}
                inputMode="decimal"
                className="st-input mt-1"
                placeholder="25"
              />
            </div>
            <div>
              <label htmlFor="priceUnit" className="st-text-muted text-xs">
                Per
              </label>
              <select
                id="priceUnit"
                value={draft.priceUnit}
                onChange={(event) =>
                  update("priceUnit", event.target.value as PriceUnit)
                }
                className="st-input mt-1"
              >
                {PRICE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {PRICE_UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Blank is a real answer here, and it is not the same as free. */}
          <p className="st-text-muted mt-1.5 text-xs">
            Leave both blank and the listing says "Ask" rather than a number.
          </p>
          {fields.priceFrom ? <p className="st-error">{fields.priceFrom}</p> : null}
          {fields.priceTo ? <p className="st-error">{fields.priceTo}</p> : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="turnaroundDays" className="st-label">
              Typical turnaround (days)
            </label>
            <input
              id="turnaroundDays"
              value={draft.turnaroundDays}
              onChange={(event) => update("turnaroundDays", event.target.value)}
              inputMode="numeric"
              className="st-input"
              placeholder="21"
            />
            {fields.turnaroundDays ? (
              <p className="st-error">{fields.turnaroundDays}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="location" className="st-label">
              Where you are
            </label>
            <input
              id="location"
              value={draft.location}
              onChange={(event) => update("location", event.target.value)}
              maxLength={60}
              className="st-input"
              placeholder="Bristol"
            />
            {fields.location ? <p className="st-error">{fields.location}</p> : null}
          </div>
        </div>

        <fieldset>
          <legend className="st-label">Systems you paint</legend>
          <div className="flex flex-wrap gap-1.5">
            {GAME_SYSTEMS.map((system) => {
              const on = draft.gameSystems.includes(system);
              return (
                <button
                  key={system}
                  type="button"
                  onClick={() => toggleSystem(system)}
                  aria-pressed={on}
                  className={`st-chip cursor-pointer ${
                    on
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
            Up to {MAX_SYSTEMS}. {draft.gameSystems.length} picked.
          </p>
          {fields.gameSystems ? (
            <p className="st-error">{fields.gameSystems}</p>
          ) : null}
        </fieldset>

        <div>
          <span className="st-label">Cover photo</span>
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

        {/*
          Prominent, and phrased as a state rather than a setting: a painter
          reaching for this has a full book and wants the enquiries to stop
          today, not to delete a listing they will rebuild in March.
        */}
        <label className="st-raised flex cursor-pointer items-start gap-3 rounded-lg p-3">
          <input
            type="checkbox"
            checked={draft.openToWork}
            onChange={(event) => update("openToWork", event.target.checked)}
            className="mt-0.5 accent-[var(--color-primer-500)]"
          />
          <span>
            <span className="st-text-strong block text-sm font-semibold">
              I am open to work
            </span>
            <span className="st-text-muted block text-sm">
              Turn this off when your book is full. The listing stays up and
              sinks down the list, and nobody is invited to enquire.
            </span>
          </span>
        </label>

        {error ? <p className="st-error">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="st-btn st-btn-primary"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Publish listing"}
          </button>
          <Link to="/commissions" className="st-btn st-btn-ghost">
            Cancel
          </Link>
        </div>
      </form>

      <p className="st-text-muted mt-4 text-xs leading-relaxed">
        SprueTube does not handle payments, hold deposits or vet anyone. Prices
        and terms are between you and whoever gets in touch.
      </p>
    </div>
  );
}
