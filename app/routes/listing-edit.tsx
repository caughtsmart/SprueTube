import { useRef, useState } from "react";
import { data, Link, redirect, useNavigate } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/listing-edit";
import { MarketSafetyNote } from "../components/ListingCard";
import { api, ApiError, uploadImage } from "../lib/api";
import { getScope } from "../lib/data.server";
import { imageSrc } from "../lib/media";
import { listing, listingMedia } from "../../server/db/schema";
import { penceToPoundsInput } from "../../server/services/market";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  LISTING_CONDITIONS,
  LISTING_CONDITION_LABELS,
  LISTING_KINDS,
  LISTING_KIND_LABELS,
  MAX_IMAGES_PER_LISTING,
  MAX_LISTING_BODY_LENGTH,
  MAX_LISTING_TITLE_LENGTH,
  SCALES,
  type ListingKind,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [
    {
      title: loaded?.draft.id
        ? "Edit listing — SprueTube"
        : "New listing — SprueTube",
    },
    { name: "robots", content: "noindex" },
  ];
}

type Draft = {
  id: string | null;
  slug: string | null;
  kind: ListingKind;
  title: string;
  body: string;
  /** Pounds as typed. The server converts to pence — see services/market.ts. */
  price: string;
  condition: string;
  gameSystem: string;
  scale: string;
  location: string;
  postageOffered: boolean;
  status: string;
  images: {
    key: string;
    imageId?: string;
    previewUrl: string | null;
    altText: string;
    width?: number | null;
    height?: number | null;
    progress: number;
    error?: string;
  }[];
};

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const url = new URL(request.url);
  if (!scope.viewer) {
    throw redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }
  if (!scope.viewer.profile.birthdate) throw redirect("/welcome");

  const me = scope.viewer.profile;
  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };
  const slug = params.slug ?? null;

  const empty: Draft = {
    id: null,
    slug: null,
    kind: "sale",
    title: "",
    body: "",
    price: "",
    condition: "",
    gameSystem: "",
    scale: "",
    location: me.location ?? "",
    postageOffered: false,
    status: "open",
    images: [],
  };

  if (!slug) return { draft: empty, username: me.username };

  /*
   * Ownership comes from the session and only from the session. The username in
   * the URL is never part of this lookup — if it were, /market/someone-else/x
   * would be an edit form for somebody else's listing the moment the slug
   * happened to match.
   */
  const existing = await scope.db.query.listing.findFirst({
    where: and(eq(listing.sellerId, me.userId), eq(listing.slug, slug)),
  });
  if (!existing || existing.status === "removed") {
    throw data({ message: "No such listing." }, { status: 404 });
  }

  const media = await scope.db
    .select()
    .from(listingMedia)
    .where(eq(listingMedia.listingId, existing.id))
    .orderBy(asc(listingMedia.position));

  return {
    draft: {
      id: existing.id,
      slug: existing.slug,
      kind: existing.kind,
      title: existing.title,
      body: existing.body ?? "",
      price: penceToPoundsInput(existing.pricePence),
      condition: existing.condition ?? "",
      gameSystem: existing.gameSystem ?? "",
      scale: existing.scale ?? "",
      location: existing.location ?? "",
      postageOffered: existing.postageOffered,
      status: existing.status,
      images: media.map((item) => ({
        key: item.id,
        imageId: item.imageId,
        previewUrl: imageSrc(config, item.imageId, "feed"),
        altText: item.altText ?? "",
        width: item.width,
        height: item.height,
        progress: 1,
      })),
    } satisfies Draft,
    username: me.username,
  };
}

export default function ListingEdit({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const imageInput = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>(loaderData.draft);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  const editing = Boolean(draft.id);
  const wanted = draft.kind === "wanted";
  const uploading = draft.images.some(
    (image) => !image.imageId && !image.error,
  );

  function patch(changes: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  async function onPickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(
      0,
      MAX_IMAGES_PER_LISTING - draft.images.length,
    );
    event.target.value = "";
    if (!files.length) return;

    const pending = files.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      altText: "",
      progress: 0,
    }));

    setDraft((current) => ({
      ...current,
      images: [...current.images, ...pending.map(({ file: _file, ...rest }) => rest)],
    }));

    // Straight to Cloudflare Images, exactly as the composer does — the bytes
    // never pass through the Worker.
    await Promise.all(
      pending.map(async (item) => {
        try {
          const result = await uploadImage(item.file, "post", (fraction) =>
            setDraft((current) => ({
              ...current,
              images: current.images.map((image) =>
                image.key === item.key
                  ? { ...image, progress: fraction }
                  : image,
              ),
            })),
          );
          setDraft((current) => ({
            ...current,
            images: current.images.map((image) =>
              image.key === item.key
                ? { ...image, ...result, progress: 1 }
                : image,
            ),
          }));
        } catch {
          setDraft((current) => ({
            ...current,
            images: current.images.map((image) =>
              image.key === item.key
                ? { ...image, error: "Upload failed. Remove and try again." }
                : image,
            ),
          }));
        }
      }),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (uploading) return;

    setSubmitting(true);
    setError(null);
    setFieldError({});

    const payload = {
      kind: draft.kind,
      title: draft.title.trim(),
      body: draft.body.trim() || null,
      price: draft.price.trim(),
      condition: draft.condition || null,
      gameSystem: draft.gameSystem || null,
      scale: draft.scale || null,
      location: draft.location.trim() || null,
      postageOffered: draft.postageOffered,
      images: draft.images
        .filter((image) => image.imageId)
        .map((image) => ({
          imageId: image.imageId!,
          width: image.width ?? null,
          height: image.height ?? null,
          altText: image.altText.trim() || null,
        })),
    };

    try {
      if (draft.id) {
        await api.patch(`/listings/${draft.id}`, payload);
        navigate(`/market/${loaderData.username}/${draft.slug}`);
      } else {
        const created = await api.post<{ slug: string; username: string }>(
          "/listings",
          payload,
        );
        navigate(`/market/${created.username}/${created.slug}`);
      }
    } catch (caught) {
      setSubmitting(false);
      if (caught instanceof ApiError) {
        setFieldError(caught.fields ?? {});
        setError(Object.values(caught.fields ?? {})[0] ?? caught.message);
      } else {
        setError("Could not save that.");
      }
    }
  }

  async function onDelete() {
    const ok = window.confirm("Delete this listing? It goes for good.");
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/listings/${draft.id}`);
      navigate("/market");
    } catch {
      setDeleting(false);
      setError("Could not delete that.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">
        {editing ? "Edit listing" : "Post a listing"}
      </h1>

      <MarketSafetyNote />

      <form onSubmit={onSubmit} className="st-card mt-4 space-y-4 p-4 sm:p-5">
        <fieldset>
          <legend className="st-label">What is this?</legend>
          <div className="flex gap-2">
            {LISTING_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => patch({ kind })}
                aria-pressed={draft.kind === kind}
                className={[
                  "st-btn py-1.5 text-sm",
                  draft.kind === kind ? "st-btn-primary" : "st-btn-ghost",
                ].join(" ")}
              >
                {LISTING_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <p className="st-text-muted mt-1 text-xs">
            {wanted
              ? "A wanted ad — you are looking for something."
              : "Something you are selling."}
          </p>
        </fieldset>

        <div>
          <label htmlFor="title" className="st-label">
            Title
          </label>
          <input
            id="title"
            value={draft.title}
            onChange={(event) => patch({ title: event.target.value })}
            maxLength={MAX_LISTING_TITLE_LENGTH}
            required
            autoFocus={!editing}
            className="st-input"
            placeholder={
              wanted
                ? "Wanted: Leviathan box, sprues only"
                : "Death Guard Plague Marines, new on sprue"
            }
          />
        </div>

        <div>
          <label htmlFor="body" className="st-label">
            Details
          </label>
          <textarea
            id="body"
            value={draft.body}
            onChange={(event) => patch({ body: event.target.value })}
            rows={5}
            maxLength={MAX_LISTING_BODY_LENGTH}
            className="st-input resize-y"
            placeholder={
              wanted
                ? "Anything from the box will do — happy with part-built."
                : "Two squads, never opened. Collection from Leeds, or postage at cost."
            }
          />
          <p className="st-text-muted mt-1 text-xs">
            {draft.body.length}/{MAX_LISTING_BODY_LENGTH}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="price" className="st-label">
              {wanted ? "Budget" : "Price"}
            </label>
            <input
              id="price"
              value={draft.price}
              onChange={(event) => patch({ price: event.target.value })}
              inputMode="decimal"
              maxLength={20}
              className="st-input"
              placeholder="£24.50"
            />
            {/*
              Blank is not free. On a sale that means "offers"; on a wanted post
              it means no budget stated. Said here because a blank field that
              silently means £0 is how somebody ends up giving away an army.
            */}
            <p className="st-text-muted mt-1 text-xs">
              {wanted
                ? "Leave it blank if you would rather not say."
                : "Leave it blank for offers. Never shown as free."}
            </p>
            {fieldError.price ? (
              <p className="st-error">{fieldError.price}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="condition" className="st-label">
              {wanted ? "Condition wanted" : "Condition"}
            </label>
            <select
              id="condition"
              value={draft.condition}
              onChange={(event) => patch({ condition: event.target.value })}
              className="st-input"
            >
              <option value="">Not specified</option>
              {LISTING_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {LISTING_CONDITION_LABELS[condition]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="gameSystem" className="st-label">
              Game or subject
            </label>
            <select
              id="gameSystem"
              value={draft.gameSystem}
              onChange={(event) => patch({ gameSystem: event.target.value })}
              className="st-input"
            >
              <option value="">Not specified</option>
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
              onChange={(event) => patch({ scale: event.target.value })}
              className="st-input"
            >
              <option value="">Not specified</option>
              {SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {scale}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="location" className="st-label">
              Roughly where are you?
            </label>
            <input
              id="location"
              value={draft.location}
              onChange={(event) => patch({ location: event.target.value })}
              maxLength={60}
              className="st-input"
              placeholder="Leeds"
            />
            {/*
              People will type their full address into any box labelled
              "address" on a page they think is private. This one is public and
              says so.
            */}
            <p className="st-text-muted mt-1 text-xs">
              A town or county — not your address. This is shown publicly.
            </p>
          </div>
        </div>

        {!wanted ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.postageOffered}
              onChange={(event) => patch({ postageOffered: event.target.checked })}
              className="accent-[var(--color-primer-500)]"
            />
            Happy to post it
          </label>
        ) : null}

        {/* Photos */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => imageInput.current?.click()}
              disabled={draft.images.length >= MAX_IMAGES_PER_LISTING}
              className="st-btn st-btn-ghost text-sm"
            >
              📷 Add photos
            </button>
            <span className="st-text-muted text-xs">
              Up to {MAX_IMAGES_PER_LISTING}.{" "}
              {wanted
                ? "A picture of what you are after helps."
                : "Photograph the actual thing, not the box art."}
            </span>
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onPickImages}
            />
          </div>

          {draft.images.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {draft.images.map((image) => (
                <li key={image.key} className="st-border rounded-lg border p-2">
                  <div className="relative">
                    {image.previewUrl ? (
                      <img
                        src={image.previewUrl}
                        alt=""
                        className="aspect-square w-full rounded object-cover"
                      />
                    ) : (
                      <div className="st-raised aspect-square w-full rounded" />
                    )}
                    {image.progress < 1 && !image.error ? (
                      <div className="absolute inset-x-0 bottom-0 h-1 rounded-b bg-black/50">
                        <div
                          className="h-full bg-[var(--color-primer-500)]"
                          style={{ width: `${Math.round(image.progress * 100)}%` }}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          images: current.images.filter(
                            (item) => item.key !== image.key,
                          ),
                        }))
                      }
                      aria-label="Remove photo"
                      className="absolute top-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <input
                    value={image.altText}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        images: current.images.map((item) =>
                          item.key === image.key
                            ? { ...item, altText: event.target.value }
                            : item,
                        ),
                      }))
                    }
                    maxLength={400}
                    placeholder="Describe it (alt text)"
                    className="st-input mt-2 text-xs"
                    aria-label="Alt text for this photo"
                  />
                  {image.error ? <p className="st-error">{image.error}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting || deleting || uploading || !draft.title.trim()}
            className="st-btn st-btn-primary"
          >
            {submitting
              ? "Saving…"
              : uploading
                ? "Waiting for photos…"
                : editing
                  ? "Save changes"
                  : "Post it"}
          </button>

          <Link
            to={
              editing
                ? `/market/${loaderData.username}/${draft.slug}`
                : "/market"
            }
            className="st-btn st-btn-ghost"
          >
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

      {/* Kept off the form: the status buttons live on the listing itself,
          where marking something sold is one click. */}
      <p className="st-text-muted mt-3 text-xs">
        {editing
          ? "Marking it sold, withdrawing it or bumping it are all on the listing page."
          : "Once it is up you can mark it sold in one click from the listing."}
      </p>
    </div>
  );
}
