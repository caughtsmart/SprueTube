import { useState } from "react";
import { data, Link, useNavigate } from "react-router";
import type { Route } from "./+types/commission";
import { Avatar } from "../components/Avatar";
import { api, ApiError } from "../lib/api";
import { getScope } from "../lib/data.server";
import { excerpt, fullDate } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { getCommission } from "../../server/services/commissions";
import {
  formatPriceRange,
  GAME_SYSTEM_LABELS,
  PRICE_UNIT_LABELS,
  type PriceUnit,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.listing) return [{ title: "Commission painting — SprueTube" }];

  const price =
    formatPriceRange(loaded.listing.priceFromPence, loaded.listing.priceToPence) ??
    "Prices on request";
  const description = `${loaded.owner.displayName} takes commission work. ${price}. ${excerpt(loaded.listing.blurb, 110)}`;

  return [
    { title: `${loaded.listing.title} — ${loaded.owner.displayName} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: loaded.listing.title },
    { property: "og:description", content: description },
    ...(loaded.coverUrl ? [{ property: "og:image", content: loaded.coverUrl }] : []),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);

  const found = await getCommission(
    scope.db,
    params.username,
    params.slug,
    scope.viewer?.userId ?? null,
  );
  if (!found) throw data({ message: "No such listing." }, { status: 404 });

  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };
  const row = found.commission;

  return {
    listing: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      blurb: row.blurb,
      priceFromPence: row.priceFromPence,
      priceToPence: row.priceToPence,
      priceUnit: row.priceUnit as PriceUnit,
      turnaroundDays: row.turnaroundDays,
      gameSystems: row.gameSystems ?? [],
      location: row.location,
      openToWork: row.openToWork,
      status: row.status,
      updatedAt: row.updatedAt,
    },
    owner: {
      username: found.owner.username,
      displayName: found.owner.displayName,
      avatarImageId: found.owner.avatarImageId,
    },
    avatarUrl: imageSrc(config, found.owner.avatarImageId, "avatar"),
    coverUrl: imageSrc(config, row.coverImageId, "full"),
    isOwner: found.isOwner,
  };
}

export default function Commission({ loaderData }: Route.ComponentProps) {
  const { listing, owner } = loaderData;
  const price = formatPriceRange(listing.priceFromPence, listing.priceToPence);

  return (
    <div className="mx-auto max-w-2xl">
      {loaderData.coverUrl ? (
        <img
          src={loaderData.coverUrl}
          alt=""
          className="st-card h-44 w-full object-cover sm:h-64"
        />
      ) : null}

      <header className={loaderData.coverUrl ? "mt-4" : ""}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-bold">{listing.title}</h1>
          {listing.openToWork ? (
            <span className="st-chip border-[var(--color-wash-500)] text-[var(--color-wash-400)]">
              Open to work
            </span>
          ) : (
            <span className="st-chip">Books closed</span>
          )}
        </div>

        <Link
          to={`/@${owner.username}`}
          className="mt-3 inline-flex items-center gap-2"
        >
          <Avatar username={owner.username} src={loaderData.avatarUrl} size={32} />
          <span className="st-text-strong text-sm font-medium">
            {owner.displayName}
          </span>
          <span className="st-text-muted text-sm">@{owner.username}</span>
        </Link>
      </header>

      <div className="st-card mt-4 p-4">
        <p className="st-text-strong text-2xl font-semibold">
          {price ?? "Ask"}
          <span className="st-text-muted ml-2 text-sm font-normal">
            {price ? PRICE_UNIT_LABELS[listing.priceUnit] : "for a quote"}
          </span>
        </p>

        <dl className="st-text-muted mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {listing.turnaroundDays ? (
            <div className="flex gap-2">
              <dt>Turnaround</dt>
              <dd className="st-text-strong">
                around {listing.turnaroundDays} days
              </dd>
            </div>
          ) : null}
          {listing.location ? (
            <div className="flex gap-2">
              <dt>Based</dt>
              <dd className="st-text-strong">{listing.location}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt>Updated</dt>
            <dd className="st-text-strong">{fullDate(listing.updatedAt)}</dd>
          </div>
        </dl>

        {listing.gameSystems.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {listing.gameSystems.map((system) => (
              <span key={system} className="st-chip">
                {GAME_SYSTEM_LABELS[system as keyof typeof GAME_SYSTEM_LABELS] ??
                  system}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
        {listing.blurb}
      </p>

      {loaderData.isOwner ? (
        <OwnerControls
          commissionId={listing.id}
          openToWork={listing.openToWork}
          editHref={`/commissions/${owner.username}/${listing.slug}/edit`}
        />
      ) : (
        <ContactPainter
          username={owner.username}
          displayName={owner.displayName}
          openToWork={listing.openToWork}
          listingHref={`/commissions/${owner.username}/${listing.slug}`}
        />
      )}

      <p className="st-text-muted mt-6 text-xs leading-relaxed">
        SprueTube does not handle payments and does not vet painters. Agree the
        work, the price and the postage between yourselves.
      </p>
    </div>
  );
}

/**
 * The one button this page exists for.
 *
 * Hidden when the painter's book is closed — that is what the switch is for.
 * The API does not refuse the message in that case, because closing your books
 * should not sever threads already running.
 */
function ContactPainter({
  username,
  displayName,
  openToWork,
  listingHref,
}: {
  username: string;
  displayName: string;
  openToWork: boolean;
  listingHref: string;
}) {
  const { viewer } = useRoot();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!openToWork) {
    return (
      <p className="st-card st-text-muted mt-6 p-4 text-sm">
        {displayName} is not taking new work at the moment. The listing stays up
        so you know where to find them when the book reopens.
      </p>
    );
  }

  if (!viewer) {
    return (
      <Link
        to={`/login?next=${encodeURIComponent(listingHref)}`}
        className="st-btn st-btn-primary mt-6"
      >
        Sign in to message {displayName}
      </Link>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const opened = await api.post<{ conversationId: string }>(
        "/conversations",
        { username },
      );
      void navigate(`/messages/${opened.conversationId}`);
    } catch (caught) {
      setBusy(false);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not open a conversation.",
      );
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="st-btn st-btn-primary"
      >
        {busy ? "Opening…" : `Message ${displayName}`}
      </button>
      {error ? <p className="st-error">{error}</p> : null}
    </div>
  );
}

function OwnerControls({
  commissionId,
  openToWork,
  editHref,
}: {
  commissionId: string;
  openToWork: boolean;
  editHref: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(openToWork);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setBusy(true);
    setError(null);
    // Optimistic: this switch gets used at the workbench with one hand.
    setOpen(next);
    try {
      await api.post(`/commissions/${commissionId}/open`, { open: next });
    } catch {
      setOpen(!next);
      setError("Could not change that.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = window.confirm(
      "Take this listing down? Closing your books instead keeps it up and stops the enquiries.",
    );
    if (!ok) return;

    setBusy(true);
    try {
      await api.delete(`/commissions/${commissionId}`);
      void navigate("/commissions");
    } catch {
      setBusy(false);
      setError("Could not take it down.");
    }
  }

  return (
    <div className="st-card mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="st-text-strong text-sm font-semibold">
            {open ? "Open to work" : "Books closed"}
          </p>
          <p className="st-text-muted mt-0.5 text-sm">
            {open
              ? "People can message you about this listing."
              : "The listing stays up, but nobody is invited to enquire."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={open ? "st-btn st-btn-ghost" : "st-btn st-btn-primary"}
        >
          {open ? "Close my books" : "Open my books"}
        </button>
      </div>

      {error ? <p className="st-error">{error}</p> : null}

      <div className="st-border mt-4 flex items-center gap-3 border-t pt-3">
        <Link to={editHref} className="st-btn st-btn-ghost text-sm">
          Edit listing
        </Link>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="st-btn st-btn-ghost ml-auto text-sm text-[#ff8080]"
        >
          Take it down
        </button>
      </div>
    </div>
  );
}
