/*
 * The hobby vocabulary, plus the size limits that both sides need to agree on.
 *
 * This module exists to be *dependency-free*. The server's Zod schemas and the
 * browser's dropdowns both need these lists, and if the shared copy lived next
 * to the validators then every route that renders a system dropdown would drag
 * Zod (~70 kB) and the Drizzle schema (~28 kB) into the client bundle — which
 * is exactly what happened before this file existed.
 *
 * Nothing here may import anything.
 */

export const GAME_SYSTEMS = [
  "warhammer-40k",
  "age-of-sigmar",
  "kill-team",
  "necromunda",
  "horus-heresy",
  "the-old-world",
  "warcry",
  "blood-bowl",
  "middle-earth",
  "star-wars-legion",
  "bolt-action",
  "infinity",
  "malifaux",
  "dnd-rpg",
  "historical",
  "scale-models",
  "terrain",
  "other",
] as const;

export type GameSystem = (typeof GAME_SYSTEMS)[number];

export const GAME_SYSTEM_LABELS: Record<GameSystem, string> = {
  "warhammer-40k": "Warhammer 40,000",
  "age-of-sigmar": "Age of Sigmar",
  "kill-team": "Kill Team",
  necromunda: "Necromunda",
  "horus-heresy": "Horus Heresy",
  "the-old-world": "The Old World",
  warcry: "Warcry",
  "blood-bowl": "Blood Bowl",
  "middle-earth": "Middle-earth",
  "star-wars-legion": "Star Wars: Legion",
  "bolt-action": "Bolt Action",
  infinity: "Infinity",
  malifaux: "Malifaux",
  "dnd-rpg": "D&D and RPGs",
  historical: "Historical",
  "scale-models": "Scale models",
  terrain: "Terrain and scenery",
  other: "Something else",
};

export const SCALES = [
  "28mm",
  "32mm",
  "54mm",
  "75mm",
  "1/72",
  "1/48",
  "1/35",
  "1/24",
  "other",
] as const;

export type Scale = (typeof SCALES)[number];

/** The stages a model passes through. This ordering is the SprueTube spine. */
export const WIP_STAGES = [
  "sprue",
  "assembled",
  "primed",
  "basecoated",
  "shaded",
  "highlighted",
  "based",
  "finished",
] as const;

export type WipStage = (typeof WIP_STAGES)[number];

export const WIP_STAGE_LABELS: Record<WipStage, string> = {
  sprue: "Still on the sprue",
  assembled: "Assembled",
  primed: "Primed",
  basecoated: "Base coated",
  shaded: "Shaded",
  highlighted: "Highlighted",
  based: "Based",
  finished: "Finished",
};

/** Shorter forms, for the chips on a post card where space is tight. */
export const WIP_STAGE_SHORT: Record<WipStage, string> = {
  sprue: "On the sprue",
  assembled: "Assembled",
  primed: "Primed",
  basecoated: "Base coated",
  shaded: "Shaded",
  highlighted: "Highlighted",
  based: "Based",
  finished: "Finished",
};

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "violence",
  "sexual",
  "self_harm",
  "child_safety",
  "illegal",
  "impersonation",
  "intellectual_property",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or threats",
  sexual: "Sexual content",
  self_harm: "Self-harm",
  child_safety: "Child safety",
  illegal: "Something illegal",
  impersonation: "Impersonation",
  intellectual_property: "Copyright or trademark",
  other: "Something else",
};

/*
 * What the contact form is about.
 *
 * The form is the only published way in, so this list has to cover everything
 * that used to have its own address — safety reports and data rights included.
 * The topic ends up in the subject line, which is what lets a shared inbox be
 * sorted and split without anything being opened, and what keeps an urgent one
 * from sitting behind a question about stockists.
 *
 * Order matters: it is the order of the dropdown, and the two that carry a
 * clock sit near the top where they will be seen rather than scrolled past.
 */
export const CONTACT_TOPICS = [
  "general",
  "safety",
  "account",
  "data",
  "bug",
  "advertising",
  "press",
  "legal",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_TOPIC_LABELS: Record<ContactTopic, string> = {
  general: "General enquiry",
  safety: "Something unsafe, or a moderation appeal",
  account: "Help with my account",
  data: "My data — a copy, a correction, or deletion",
  bug: "Something is broken",
  advertising: "Advertising or partnerships",
  press: "Press",
  legal: "Legal",
};

/**
 * Topics that get read before the rest.
 *
 * Safety has published response times on /safety and a data rights request
 * starts a one-month statutory clock the moment it arrives. Marking them in the
 * subject line is the cheapest way to keep either from being missed in a shared
 * inbox that also receives questions about postage.
 */
export const URGENT_CONTACT_TOPICS: ContactTopic[] = ["safety", "data"];

/*
 * What state a build log is in.
 *
 * "Abandoned" earns its place. Every painter has a box of half-finished things,
 * and a project list that only admits success is a list people stop updating —
 * they quietly leave the dead ones marked active rather than admit to them.
 * Naming it makes it ordinary.
 */
export const PROJECT_STATUSES = ["active", "finished", "abandoned"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "On the workbench",
  finished: "Finished",
  abandoned: "Shelved",
};

/** Limits enforced by the API and mirrored by the composer. */
export const MAX_PROJECT_TITLE_LENGTH = 120;
export const MAX_PROJECT_SUMMARY_LENGTH = 500;

/* Limits enforced by the API and mirrored by the composer. */
export const MAX_BODY_LENGTH = 5000;
export const MAX_IMAGES_PER_POST = 8;
export const MAX_TAGS_PER_POST = 10;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_BIO_LENGTH = 280;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/**
 * Shared by the sign-up form, the reset form and better-auth itself. A UI that
 * accepts a password the server then rejects is a bug that only shows up to the
 * user, so all three read this.
 */
export const MIN_PASSWORD_LENGTH = 10;
/** Minimum age for an account, per the Online Safety Act and the App Store. */
export const MINIMUM_AGE = 13;

/* -------------------------------------------------------------------------- */
/* Marketplace                                                                */
/* -------------------------------------------------------------------------- */

export const LISTING_KINDS = ["sale", "wanted"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_KIND_LABELS: Record<ListingKind, string> = {
  sale: "For sale",
  wanted: "Wanted",
};

/*
 * Condition in the vocabulary the hobby actually uses. "New on sprue" and "new
 * sealed" are different things to a buyer and the same thing to every generic
 * marketplace, which is exactly the gap a specific site should close.
 */
export const LISTING_CONDITIONS = [
  "new_sealed",
  "new_sprue",
  "part_built",
  "painted",
  "damaged",
] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const LISTING_CONDITION_LABELS: Record<ListingCondition, string> = {
  new_sealed: "New, sealed",
  new_sprue: "New on sprue",
  part_built: "Part built",
  painted: "Painted",
  damaged: "Damaged or incomplete",
};

export const LISTING_STATUSES = ["open", "sold", "withdrawn"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const MAX_LISTING_TITLE_LENGTH = 120;
export const MAX_LISTING_BODY_LENGTH = 4000;
export const MAX_IMAGES_PER_LISTING = 8;

/* -------------------------------------------------------------------------- */
/* Commissions                                                                */
/* -------------------------------------------------------------------------- */

export const PRICE_UNITS = ["model", "unit", "army", "hour", "project"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  model: "per model",
  unit: "per unit",
  army: "per army",
  hour: "per hour",
  project: "per project",
};

export const MAX_COMMISSION_TITLE_LENGTH = 120;
export const MAX_COMMISSION_BLURB_LENGTH = 2000;

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export const MAX_MESSAGE_LENGTH = 4000;

/* -------------------------------------------------------------------------- */
/* News                                                                       */
/* -------------------------------------------------------------------------- */

export const NEWS_CATEGORIES = ["warhammer", "wider"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  warhammer: "Warhammer",
  wider: "Wider hobby",
};

/**
 * Money is stored in pence and formatted here.
 *
 * Never a float: £47.99 has no exact binary representation, and a rounding
 * error in a price is the kind of bug people notice and do not forgive.
 */
export function formatPence(pence: number | null | undefined): string | null {
  if (pence == null) return null;
  const pounds = Math.trunc(pence / 100);
  const remainder = Math.abs(pence % 100);
  return remainder === 0
    ? `£${pounds}`
    : `£${pounds}.${remainder.toString().padStart(2, "0")}`;
}

/** "£20–£45", "£20+", "from £20", or null when nothing is set. */
export function formatPriceRange(
  fromPence: number | null | undefined,
  toPence: number | null | undefined,
): string | null {
  const from = formatPence(fromPence);
  const to = formatPence(toPence);
  if (from && to) return from === to ? from : `${from}–${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return null;
}
