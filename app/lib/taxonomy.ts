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

/* Limits enforced by the API and mirrored by the composer. */
export const MAX_BODY_LENGTH = 5000;
export const MAX_IMAGES_PER_POST = 8;
export const MAX_TAGS_PER_POST = 10;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_BIO_LENGTH = 280;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Minimum age for an account, per the Online Safety Act and the App Store. */
export const MINIMUM_AGE = 13;
