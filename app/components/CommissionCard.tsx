import { Link } from "react-router";
import { Avatar } from "./Avatar";
import { imageSrc, type MediaConfig } from "../lib/media";
import {
  formatPriceRange,
  GAME_SYSTEM_LABELS,
  PRICE_UNIT_LABELS,
  type PriceUnit,
} from "../lib/taxonomy";

export type CommissionSummary = {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  priceFromPence: number | null;
  priceToPence: number | null;
  priceUnit: PriceUnit;
  turnaroundDays: number | null;
  gameSystems: string[];
  coverImageId: string | null;
  location: string | null;
  openToWork: boolean;
  owner: {
    username: string;
    displayName: string;
    avatarImageId: string | null;
  };
};

/**
 * One painter's listing in the browse list.
 *
 * The price line is the thing people came for, so it is the largest text after
 * the name. When there is no price it says "Ask" — never "£0", which would read
 * as free work and is the single most damaging thing this card could get wrong.
 */
export function CommissionCard({
  commission,
  config,
}: {
  commission: CommissionSummary;
  config: MediaConfig;
}) {
  const price = formatPriceRange(
    commission.priceFromPence,
    commission.priceToPence,
  );
  const cover = imageSrc(config, commission.coverImageId, "feed");
  const href = `/commissions/${commission.owner.username}/${commission.slug}`;

  return (
    <article className="st-card overflow-hidden">
      <Link to={href} className="block">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-40 w-full object-cover sm:h-48"
          />
        ) : null}

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="st-text-strong text-base font-semibold">
              {commission.title}
            </h2>
            {commission.openToWork ? (
              <span className="st-chip shrink-0 border-[var(--color-wash-500)] text-[var(--color-wash-400)]">
                Open to work
              </span>
            ) : (
              <span className="st-chip shrink-0">Books closed</span>
            )}
          </div>

          <p className="st-text-muted mt-2 line-clamp-2 text-sm leading-relaxed">
            {commission.blurb}
          </p>

          <p className="st-text-strong mt-3 text-lg font-semibold">
            {price ?? "Ask"}
            <span className="st-text-muted ml-1.5 text-sm font-normal">
              {price
                ? PRICE_UNIT_LABELS[commission.priceUnit]
                : "— get in touch for a quote"}
            </span>
          </p>

          <div className="st-text-muted mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {commission.turnaroundDays ? (
              <span>Around {commission.turnaroundDays} days</span>
            ) : null}
            {commission.location ? <span>{commission.location}</span> : null}
          </div>

          {commission.gameSystems.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {commission.gameSystems.slice(0, 4).map((system) => (
                <span key={system} className="st-chip">
                  {GAME_SYSTEM_LABELS[
                    system as keyof typeof GAME_SYSTEM_LABELS
                  ] ?? system}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Link>

      <div className="st-border flex items-center gap-2 border-t px-4 py-3">
        <Link
          to={`/@${commission.owner.username}`}
          className="flex items-center gap-2"
        >
          <Avatar
            username={commission.owner.username}
            src={imageSrc(config, commission.owner.avatarImageId, "avatar")}
            size={28}
          />
          <span className="st-text-strong text-sm font-medium">
            {commission.owner.displayName}
          </span>
          <span className="st-text-muted text-sm">
            @{commission.owner.username}
          </span>
        </Link>
      </div>
    </article>
  );
}
