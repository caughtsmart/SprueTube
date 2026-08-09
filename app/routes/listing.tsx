import { useState } from "react";
import { data, Link, useRevalidator } from "react-router";
import type { Route } from "./+types/listing";
import { Avatar } from "../components/Avatar";
import { MarketSafetyNote } from "../components/ListingCard";
import { api, ApiError } from "../lib/api";
import { getScope } from "../lib/data.server";
import { fullDate, parseBody, timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import {
  getListing,
  hoursUntilBump,
  recordListingView,
} from "../../server/services/market";
import {
  GAME_SYSTEM_LABELS,
  LISTING_CONDITION_LABELS,
  LISTING_KIND_LABELS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "../lib/taxonomy";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded?.listing) return [{ title: "Listing — SprueTube" }];

  const { listing, seller } = loaded;
  const kind = LISTING_KIND_LABELS[listing.kind];
  const description = listing.body
    ? listing.body.slice(0, 160)
    : `${kind} on SprueTube${listing.priceLabel ? ` — ${listing.priceLabel}` : ""}.`;

  return [
    { title: `${listing.title} — ${kind} — SprueTube` },
    { name: "description", content: description },
    { property: "og:title", content: listing.title },
    { property: "og:description", content: description },
    ...(loaded.photos[0]
      ? [{ property: "og:image", content: loaded.photos[0].url }]
      : []),
    // Sold and withdrawn listings stay reachable for anyone holding the link,
    // but there is no reason for a search engine to keep offering them.
    ...(listing.status === "open"
      ? []
      : [{ name: "robots", content: "noindex" }]),
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  const viewerId = scope.viewer?.userId ?? null;

  const found = await getListing(
    scope.db,
    params.username,
    params.slug,
    viewerId,
  );
  if (!found) throw data({ message: "No such listing." }, { status: 404 });

  const { listing, isOwner } = found;

  // Fire and forget, and never the seller's own refreshes — a view count that
  // counts the owner staring at their own advert is just noise.
  if (!isOwner) {
    scope.ctx.waitUntil(
      recordListingView(scope.db, listing.id).catch(() => undefined),
    );
  }

  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };

  return {
    listing,
    seller: listing.seller,
    isOwner,
    signedIn: Boolean(scope.viewer),
    avatarUrl: imageSrc(config, listing.seller.avatarImageId, "avatar"),
    photos: listing.media
      .map((item) => ({
        url: imageSrc(config, item.imageId, "full"),
        alt: item.altText ?? "",
      }))
      .filter((photo): photo is { url: string; alt: string } =>
        Boolean(photo.url),
      ),
    /** Zero when it can be bumped now. Computed here so the page never has to. */
    bumpInHours: isOwner ? hoursUntilBump(listing.bumpedAt) : 0,
  };
}

export default function ListingPage({ loaderData }: Route.ComponentProps) {
  const { listing, seller, isOwner, photos } = loaderData;
  const revalidator = useRevalidator();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted = listing.kind === "wanted";

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await revalidator.revalidate();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    listing.condition ? LISTING_CONDITION_LABELS[listing.condition] : null,
    listing.gameSystem
      ? (GAME_SYSTEM_LABELS[
          listing.gameSystem as keyof typeof GAME_SYSTEM_LABELS
        ] ?? listing.gameSystem)
      : null,
    listing.scale,
    listing.location,
    listing.postageOffered && !wanted ? "Happy to post" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/market" className="st-text-muted text-sm hover:underline">
        ← Buy and sell
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            background: wanted
              ? "var(--color-wash-500)"
              : "var(--color-primer-500)",
            color: "#14161b",
          }}
        >
          {LISTING_KIND_LABELS[listing.kind]}
        </span>
        {listing.status !== "open" ? (
          <span className="st-chip">
            {listing.status === "sold" ? "Sold" : "Withdrawn"}
          </span>
        ) : null}
      </div>

      <h1 className="mt-2 text-xl font-bold">{listing.title}</h1>

      {listing.priceLabel ? (
        <p className="st-text-strong mt-1 text-2xl font-bold">
          {listing.priceLabel}
        </p>
      ) : null}

      {photos.length ? (
        <div className="mt-4">
          <img
            src={photos[active]!.url}
            alt={photos[active]!.alt}
            className="st-card w-full object-cover"
          />
          {photos.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <button
                  key={photo.url}
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`Photo ${index + 1}`}
                  aria-current={index === active}
                  className={[
                    "h-16 w-16 overflow-hidden rounded-lg border",
                    index === active
                      ? "border-[var(--color-primer-500)]"
                      : "st-border",
                  ].join(" ")}
                >
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {facts.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {facts.map((fact) => (
            <span key={fact} className="st-chip">
              {fact}
            </span>
          ))}
        </div>
      ) : null}

      {listing.body ? (
        <div className="mt-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
          {/* Same renderer as a post body: segments, never raw HTML. */}
          {parseBody(listing.body).map((segment, index) =>
            segment.type === "link" ? (
              <a
                key={index}
                href={segment.value}
                rel="noopener nofollow ugc"
                className="st-link"
              >
                {segment.value}
              </a>
            ) : segment.type === "mention" ? (
              <Link key={index} to={`/@${segment.value}`} className="st-link">
                @{segment.value}
              </Link>
            ) : segment.type === "tag" ? (
              <Link key={index} to={`/tags/${segment.value}`} className="st-link">
                #{segment.value}
              </Link>
            ) : (
              <span key={index}>{segment.value}</span>
            ),
          )}
        </div>
      ) : null}

      {/* Seller */}
      <div className="st-card mt-6 p-4">
        <div className="flex items-center gap-3">
          <Link to={`/@${seller.username}`}>
            <Avatar
              username={seller.username}
              src={loaderData.avatarUrl}
              size={40}
            />
          </Link>
          <div className="min-w-0">
            <Link
              to={`/@${seller.username}`}
              className="st-text-strong text-sm font-semibold hover:underline"
            >
              {seller.displayName}
            </Link>
            <p className="st-text-muted text-xs">@{seller.username}</p>
          </div>
        </div>

        {!isOwner && listing.status === "open" ? (
          /*
           * Contact is a message, nothing more. There is no offer flow, no
           * "buy" button and no money: the two of them arrange it between
           * themselves, exactly as they would in a club.
           *
           * The messages section is being built alongside this one, so the link
           * hands over a username in the query string rather than reaching into
           * a conversations API that does not exist here yet.
           */
          loaderData.signedIn ? (
            <Link
              to={`/messages?to=${encodeURIComponent(seller.username)}`}
              className="st-btn st-btn-primary mt-4 w-full"
            >
              {wanted ? "Message them" : "Message the seller"}
            </Link>
          ) : (
            <Link
              to={`/login?next=${encodeURIComponent(
                `/market/${seller.username}/${listing.slug}`,
              )}`}
              className="st-btn st-btn-primary mt-4 w-full"
            >
              Sign in to message
            </Link>
          )
        ) : null}
      </div>

      {isOwner ? (
        <OwnerControls
          listing={listing}
          username={seller.username}
          busy={busy}
          bumpInHours={loaderData.bumpInHours}
          onStatus={(status) =>
            void act(() => api.post(`/listings/${listing.id}/status`, { status }))
          }
          onBump={() => void act(() => api.post(`/listings/${listing.id}/bump`))}
        />
      ) : null}

      {error ? <p className="st-error mt-3">{error}</p> : null}

      <p className="st-text-muted mt-6 text-xs">
        Listed {fullDate(listing.createdAt)}
        {listing.bumpedAt > listing.createdAt
          ? ` · bumped ${timeAgo(listing.bumpedAt)}`
          : ""}
        {isOwner ? ` · ${listing.viewCount} views` : ""}
      </p>

      <div className="mt-4">
        <MarketSafetyNote />
      </div>

      {!isOwner && loaderData.signedIn ? (
        <ReportListing listingId={listing.id} />
      ) : null}
    </div>
  );
}

/**
 * The seller's own controls.
 *
 * "Mark as sold" is a single button at the top of this block and takes one
 * click with no confirmation step. It is the most common thing anyone does with
 * their own listing, and every extra tap between here and it is another listing
 * that quietly goes stale on the board.
 */
function OwnerControls({
  listing,
  username,
  busy,
  bumpInHours,
  onStatus,
  onBump,
}: {
  listing: { id: string; slug: string; status: string };
  username: string;
  busy: boolean;
  bumpInHours: number;
  onStatus: (status: "open" | "sold" | "withdrawn") => void;
  onBump: () => void;
}) {
  return (
    <div className="st-card mt-4 p-4">
      <h2 className="text-sm font-semibold">Your listing</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {listing.status === "open" ? (
          <button
            type="button"
            onClick={() => onStatus("sold")}
            disabled={busy}
            className="st-btn st-btn-primary text-sm"
          >
            Mark as sold
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStatus("open")}
            disabled={busy}
            className="st-btn st-btn-primary text-sm"
          >
            List it again
          </button>
        )}

        <Link
          to={`/market/${username}/${listing.slug}/edit`}
          className="st-btn st-btn-ghost text-sm"
        >
          Edit
        </Link>

        {listing.status === "open" ? (
          <>
            <button
              type="button"
              onClick={onBump}
              disabled={busy || bumpInHours > 0}
              className="st-btn st-btn-ghost text-sm"
            >
              Bump
            </button>
            <button
              type="button"
              onClick={() => onStatus("withdrawn")}
              disabled={busy}
              className="st-btn st-btn-ghost text-sm"
            >
              Withdraw
            </button>
          </>
        ) : null}
      </div>

      <p className="st-text-muted mt-3 text-xs">
        {bumpInHours > 0
          ? `Bumping moves this back to the top of the board. Available again in about ${bumpInHours} ${
              bumpInHours === 1 ? "hour" : "hours"
            }.`
          : "Bumping moves this back to the top of the board, once a day at most."}
      </p>
    </div>
  );
}

/**
 * Reporting, on its own endpoint.
 *
 * The shared ReportButton posts to /reports, whose validator only admits posts,
 * comments and people — so listings get this until that widens. Same reasons,
 * same queue, same priorities.
 */
function ReportListing({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api.post(`/listings/${listingId}/report`, {
        reason,
        details: details.trim() || null,
      });
      setState("sent");
    } catch (caught) {
      setState("idle");
      setError(
        caught instanceof ApiError ? caught.message : "Could not send that.",
      );
    }
  }

  if (state === "sent") {
    return (
      <p className="st-text-muted mt-4 text-xs">
        Report sent. A moderator will look at it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="st-text-muted mt-4 text-xs hover:underline"
      >
        Report this listing
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="st-card mt-4 p-4">
      <h2 className="text-sm font-semibold">Report this listing</h2>

      <label className="st-label mt-3">Reason</label>
      <select
        value={reason}
        onChange={(event) => setReason(event.target.value as ReportReason)}
        className="st-input"
      >
        {REPORT_REASONS.map((value) => (
          <option key={value} value={value}>
            {REPORT_REASON_LABELS[value]}
          </option>
        ))}
      </select>

      <label className="st-label mt-3">Anything else? (optional)</label>
      <textarea
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        rows={3}
        maxLength={2000}
        className="st-input resize-y"
        placeholder="Context helps us act faster."
      />

      {error ? <p className="st-error">{error}</p> : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="st-btn st-btn-ghost text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state === "sending"}
          className="st-btn st-btn-primary text-sm"
        >
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}
