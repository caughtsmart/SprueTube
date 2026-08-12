import { useEffect, useRef } from "react";
import type { ServedAd } from "../../server/services/ads";
import { useRoot } from "../root";

/*
 * One component, two behaviours:
 *
 *   - AdSense configured → render the network unit.
 *   - Not configured (or it returns nothing) → render a house ad from D1.
 *
 * The house ad is not a placeholder to delete later. AdSense fills nowhere near
 * 100% of impressions on a small site, and an empty ad box is wasted space that
 * could have been a Loaded Dice referral.
 *
 * Everything here is labelled. Undisclosed advertising in a feed is both a
 * Google policy breach and, in the UK, an ASA/CAP problem.
 */

export function AdSlot({
  slot,
  ad,
  className = "",
}: {
  slot: "feed" | "sidebar" | "post";
  ad: ServedAd | null;
  className?: string;
}) {
  const { adsenseClient } = useRoot().config;

  // A network unit only where AdSense is configured *and* this slot has a real
  // slot id. Until the slot ids are filled in, keep serving the house ad rather
  // than an empty box — the loader script in the head is already live for
  // verification and Auto ads.
  if (adsenseClient && SLOT_IDS[slot]) {
    return <AdSenseUnit client={adsenseClient} slot={slot} className={className} />;
  }
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

const SLOT_IDS: Record<string, string> = {
  // Slot ids from the AdSense dashboard. An empty slot keeps serving the house
  // ad, so positions can be switched on one at a time.
  feed: "2579941153",
  sidebar: "",
  post: "2659832205",
};

function AdSenseUnit({
  client,
  slot,
  className,
}: {
  client: string;
  slot: "feed" | "sidebar" | "post";
  className?: string;
}) {
  const ref = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    // React strict mode mounts twice in development; pushing the same slot
    // twice makes AdSense log "already have ads in them" and blank the unit.
    if (pushed.current || !ref.current) return;
    pushed.current = true;
    try {
      const adsbygoogle =
        ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ??= []);
      adsbygoogle.push({});
    } catch {
      // An ad blocker rejecting the push is expected and not worth reporting.
    }
  }, []);

  const slotId = SLOT_IDS[slot];
  if (!slotId) return null;

  return (
    <aside
      className={`max-w-full overflow-hidden ${className}`}
      aria-label="Advertisement"
    >
      <p className="st-text-muted mb-1 text-[0.625rem] font-semibold tracking-widest uppercase">
        Advertisement
      </p>
      <ins
        ref={ref}
        className="adsbygoogle block w-full max-w-full"
        style={{ display: "block", textAlign: slot === "post" ? "center" : undefined }}
        data-ad-client={client}
        data-ad-slot={slotId}
        data-ad-format={slot === "sidebar" ? "vertical" : "fluid"}
        data-ad-layout={slot === "post" ? "in-article" : undefined}
        data-ad-layout-key={slot === "feed" ? "-fl+5z+3v-d0+94" : undefined}
        data-full-width-responsive="true"
      />
    </aside>
  );
}

/** Loaded once in the document head when AdSense is configured. */
export function AdSenseScript() {
  const { adsenseClient } = useRoot().config;
  if (!adsenseClient) return null;

  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
      crossOrigin="anonymous"
    />
  );
}
