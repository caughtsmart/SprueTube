import { useEffect, useState } from "react";
import type { ServedAd } from "../../server/services/ads";
import { api } from "../lib/api";

/*
 * Advertising on SprueTube is Loaded Dice, and only Loaded Dice.
 *
 * There is no third-party ad network here — no AdSense, no Google script in the
 * head, no `adsbygoogle`. House ads served from D1 fill every slot, and because
 * they are ours the layout is built against real ad-shaped boxes rather than a
 * network's iframe, there is no cookie-consent banner owed for third-party ad
 * cookies, and every impression is a Loaded Dice referral rather than a few
 * pence of programmatic fill.
 *
 * Everything here is labelled. Undisclosed advertising in a feed is both bad
 * manners and, in the UK, an ASA/CAP problem — so the "Advertisement" rail and
 * heading are not optional decoration.
 */

export function AdSlot({
  ad,
  className = "",
}: {
  slot?: "feed" | "sidebar" | "post";
  ad: ServedAd | null;
  className?: string;
}) {
  if (!ad) return null;
  return <HouseAd ad={ad} className={className} />;
}

/**
 * A slot that fetches its own ad on the client.
 *
 * The sidebar lives in the app chrome, which has no route loader to hand it an
 * ad, so it asks the API for one after mount. `/ads` records the impression
 * server-side and returns a house ad; an empty response (or a blocked request)
 * simply renders nothing and the rail collapses.
 */
export function SelfFetchingAd({
  slot,
  className = "",
}: {
  slot: "feed" | "sidebar" | "post";
  className?: string;
}) {
  const [ad, setAd] = useState<ServedAd | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ ad: ServedAd | null }>(`/ads?slot=${slot}`)
      .then((result) => {
        if (live) setAd(result.ad);
      })
      .catch(() => {
        // A failed fetch leaves the rail empty, which is the right fallback.
      });
    return () => {
      live = false;
    };
  }, [slot]);

  if (!ad) return null;
  return <HouseAd ad={ad} className={className} />;
}

function HouseAd({ ad, className }: { ad: ServedAd; className?: string }) {
  return (
    <aside
      className={`st-card flex overflow-hidden ${className}`}
      aria-label="Advertisement"
    >
      {/*
        Commercial content carries the rail, exactly as the paints strip does.
        An advert and a paid paint link are the same kind of thing and should
        be marked the same way.
      */}
      <span aria-hidden className="st-hazard-rail" />
      <div className="min-w-0 flex-1">
        <p className="st-text-muted st-border border-b px-4 py-1.5 text-[0.625rem] font-semibold tracking-widest uppercase">
          Advertisement
        </p>

        <a
          href={`/api/v1/ads/${ad.id}/click`}
          rel="sponsored noopener"
          target="_blank"
          className="block"
        >
          {ad.imageUrl ? (
            <img
              src={ad.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-40 w-full object-cover"
            />
          ) : null}
          <div className="p-4">
            <h3 className="text-base font-semibold">{ad.title}</h3>
            {ad.body ? (
              <p className="st-text-muted mt-1 text-sm leading-relaxed">
                {ad.body}
              </p>
            ) : null}
            <span className="st-btn st-btn-ghost mt-3 text-sm">
              {ad.ctaLabel} ↗
            </span>
          </div>
        </a>
      </div>
    </aside>
  );
}
