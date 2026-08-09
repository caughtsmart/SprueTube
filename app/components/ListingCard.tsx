import { Link } from "react-router";
import type { ListingSummary } from "../../server/services/market";
import { timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import {
  GAME_SYSTEM_LABELS,
  LISTING_CONDITION_LABELS,
  LISTING_KIND_LABELS,
} from "../lib/taxonomy";

/**
 * One listing in a browse list.
 *
 * A wanted post and a for-sale post carry the same fields and read almost
 * identically at a glance, which is confusing in exactly the way that wastes
 * people's time — somebody messages a buyer to ask what condition their
 * Leviathan box is in. So the kind is said three ways: a coloured badge, a
 * coloured edge, and the price wording ("£45" against "paying up to £45").
 */
export function ListingCard({ listing }: { listing: ListingSummary }) {
  const { config } = useRoot();
  const wanted = listing.kind === "wanted";
  const cover = imageSrc(config, listing.imageId, "feed");

  const facts = [
    listing.condition ? LISTING_CONDITION_LABELS[listing.condition] : null,
    listing.gameSystem
      ? (GAME_SYSTEM_LABELS[
          listing.gameSystem as keyof typeof GAME_SYSTEM_LABELS
        ] ?? listing.gameSystem)
      : null,
    listing.location,
    listing.postageOffered && !wanted ? "Will post" : null,
  ].filter(Boolean) as string[];

  return (
    <article
      className="st-card overflow-hidden border-l-4"
      style={{
        borderLeftColor: wanted
          ? "var(--color-wash-500)"
          : "var(--color-primer-500)",
      }}
    >
      <Link to={`/market/${listing.seller.username}/${listing.slug}`} className="block">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="st-raised st-text-muted flex aspect-[4/3] w-full items-center justify-center text-3xl">
            {wanted ? "🔍" : "📦"}
          </div>
        )}

        <div className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
              style={{
                background: wanted
                  ? "var(--color-wash-500)"
                  : "var(--color-primer-500)",
                color: "var(--color-on-amber)",
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

          <h3 className="st-text-strong mt-2 line-clamp-2 text-sm font-semibold">
            {listing.title}
          </h3>

          {/*
            Null is "offers" on a sale and "no budget stated" on a wanted post —
            never £0. The wording is decided on the server so both this card and
            the listing page say the same thing.
          */}
          {listing.priceLabel ? (
            <p className="st-text-strong mt-1 text-base font-bold">
              {listing.priceLabel}
            </p>
          ) : null}

          {facts.length ? (
            <p className="st-text-muted mt-1 line-clamp-1 text-xs">
              {facts.join(" · ")}
            </p>
          ) : null}

          <p className="st-text-muted mt-2 text-xs">
            {listing.seller.displayName} · {timeAgo(listing.bumpedAt)}
          </p>
        </div>
      </Link>
    </article>
  );
}

/**
 * The safety note, on every market page.
 *
 * Short on purpose. It has to be read, and the thing it needs to say is small:
 * we are not in the middle of this. A page of legal text would be skipped, and
 * skipped text protects nobody.
 */
export function MarketSafetyNote() {
  return (
    <p className="st-card st-text-muted p-3 text-xs leading-relaxed">
      SprueTube does not handle payments and does not vet sellers. Meet in
      person where you can, or pay by a method with buyer protection. Anything
      that looks like a scam —{" "}
      <Link to="/safety" className="st-link">
        report it
      </Link>
      .
    </p>
  );
}
