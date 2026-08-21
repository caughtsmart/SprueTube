import { z } from "zod";
import {
  CONTACT_TOPICS,
  FEEDBACK_KINDS,
  GAME_SYSTEMS,
  MAX_BODY_LENGTH,
  MAX_FEEDBACK_BODY,
  MAX_FEEDBACK_TITLE,
  PIN_KINDS,
  MAX_IMAGES_PER_POST,
  MAX_RECIPE_SUMMARY,
  MAX_RECIPE_TITLE,
  MAX_STEP_NOTE,
  MAX_STEP_PRODUCT_NAME,
  MAX_STEPS_PER_RECIPE,
  PROJECT_STATUSES,
  REPORT_REASONS,
  SCALES,
  TECHNIQUES,
  USERNAME_MAX,
  USERNAME_MIN,
  WIP_STAGES,
} from "../../app/lib/taxonomy";

/*
 * The vocabulary itself lives in app/lib/taxonomy.ts, which has no imports.
 * Keeping it there means the composer's dropdowns can use the same lists
 * without dragging Zod and the Drizzle schema into the browser bundle.
 */
export {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  SCALES,
  TECHNIQUES,
  TECHNIQUE_LABELS,
  WIP_STAGES,
  WIP_STAGE_LABELS,
} from "../../app/lib/taxonomy";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : null))
    .nullish();

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscores only.");

export const onboardingSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(50),
  /** Collected once for the 13+ age gate, then never shown publicly. */
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker."),
  bio: optionalTrimmed(280),
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: optionalTrimmed(280),
  location: optionalTrimmed(60),
  websiteUrl: z
    .string()
    .trim()
    .url("That does not look like a link.")
    .max(200)
    .nullish()
    .or(z.literal("").transform(() => null)),
  pronouns: optionalTrimmed(30),
  systems: z.array(z.enum(GAME_SYSTEMS)).max(6).optional(),
  avatarImageId: z.string().max(100).nullish(),
  bannerImageId: z.string().max(100).nullish(),
});

export const createPostSchema = z
  .object({
    kind: z.enum(["text", "images"]),
    title: optionalTrimmed(120),
    body: z.string().trim().max(MAX_BODY_LENGTH).nullish(),
    gameSystem: z.enum(GAME_SYSTEMS).nullish(),
    scale: z.enum(SCALES).nullish(),
    wipStage: z.enum(WIP_STAGES).nullish(),
    visibility: z.enum(["public", "followers", "private"]).default("public"),
    sensitive: z.boolean().default(false),
    projectId: z.string().max(60).nullish(),
    tags: z.array(z.string().max(30)).max(10).optional(),
    images: z
      .array(
        z.object({
          imageId: z.string().min(1).max(100),
          width: z.number().int().positive().max(20000).optional(),
          height: z.number().int().positive().max(20000).optional(),
          altText: z.string().trim().max(400).optional(),
        }),
      )
      .max(MAX_IMAGES_PER_POST)
      .optional(),
    products: z
      .array(
        z.object({
          kind: z.enum(["paint", "kit", "tool", "other"]).default("paint"),
          name: z.string().trim().min(1).max(120),
          brand: optionalTrimmed(60),
          shopUrl: z.string().url().max(400).nullish(),
        }),
      )
      .max(20)
      .optional(),
  })
  .superRefine((value, ctx) => {
    // A post has to actually contain something.
    if (value.kind === "text" && !value.body) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Write something first.",
      });
    }
    if (value.kind === "images" && !value.images?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["images"],
        message: "Add at least one photo.",
      });
    }
  });

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  parentId: z.string().max(60).nullish(),
});

/*
 * Messages are absent on purpose. Reporting one has to prove the reporter is in
 * the thread, which this endpoint cannot do — so messages keep their own route
 * at POST /messages/:id/report, which checks participation and then calls the
 * same service. Everything else reports through here.
 */
export const reportSchema = z.object({
  subjectType: z.enum(["post", "comment", "user", "project", "listing"]),
  subjectId: z.string().min(1).max(60),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).nullish(),
});

/*
 * The contact form. Open to anyone, signed in or not.
 *
 * `website` is a honeypot: the field exists in the markup, is hidden from
 * people and left empty by them, and is filled in by the sort of bot that
 * walks a page looking for inputs. Anything in it is a bot, and the endpoint
 * answers with a cheerful 200 rather than an error, because telling a spammer
 * which of their submissions failed is how they find the field to leave alone.
 */
export const contactSchema = z.object({
  topic: z.enum(CONTACT_TOPICS),
  name: z.string().trim().min(1, "Tell us what to call you.").max(80),
  email: z.string().trim().email("That does not look like an email address.").max(254),
  message: z
    .string()
    .trim()
    .min(10, "A little more than that — we want to be able to help.")
    .max(4000),
  website: z.string().max(200).optional(),
});

export const moderationSchema = z.object({
  action: z.enum([
    "remove_post",
    "restore_post",
    "remove_comment",
    "restore_comment",
    "suspend_user",
    "unsuspend_user",
    "dismiss_report",
    "mark_sensitive",
  ]),
  subjectType: z.enum(["post", "comment", "user"]),
  subjectId: z.string().min(1).max(60),
  reportId: z.string().max(60).nullish(),
  reason: z.string().trim().max(500).nullish(),
  notifyUser: z.boolean().default(true),
});

export const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: optionalTrimmed(500),
  gameSystem: z.enum(GAME_SYSTEMS).nullish(),
  scale: z.enum(SCALES).nullish(),
  status: z.enum(PROJECT_STATUSES).default("active"),
  coverImageId: z.string().max(100).nullish(),
});

/*
 * Every field optional, because an edit form sends only what changed — and
 * `.partial()` on the schema above would make `status` optional while keeping
 * its default, so omitting it would silently reset a finished project to
 * active.
 */
export const projectPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: optionalTrimmed(500),
  gameSystem: z.enum(GAME_SYSTEMS).nullish(),
  scale: z.enum(SCALES).nullish(),
  status: z.enum(PROJECT_STATUSES).optional(),
  coverImageId: z.string().max(100).nullish(),
});

/* -------------------------------------------------------------------------- */
/* Recipes                                                                    */
/* -------------------------------------------------------------------------- */

const recipeStepInput = z.object({
  technique: z.enum(TECHNIQUES),
  productName: optionalTrimmed(MAX_STEP_PRODUCT_NAME),
  brand: optionalTrimmed(60),
  note: optionalTrimmed(MAX_STEP_NOTE),
});

export const recipeSchema = z.object({
  title: z.string().trim().min(1).max(MAX_RECIPE_TITLE),
  summary: optionalTrimmed(MAX_RECIPE_SUMMARY),
  gameSystem: z.enum(GAME_SYSTEMS).nullish(),
  scale: z.enum(SCALES).nullish(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  steps: z.array(recipeStepInput).max(MAX_STEPS_PER_RECIPE).default([]),
});

/*
 * An edit sends the whole recipe, steps included — the step editor works on the
 * full list and the service replaces it wholesale, so unlike the project patch
 * there is nothing to merge. Title and visibility still carry their meaning, so
 * they are required here rather than optional.
 */
export const recipePatchSchema = recipeSchema;

/** Attaching an existing recipe to one of your posts. */
export const attachRecipeSchema = z.object({
  recipeId: z.string().min(1).max(60),
});

/*
 * The notification `type` values a person can mute. Kept in step with the enum
 * on the `notification` table (server/db/schema.ts). `system` is deliberately
 * absent — a moderation or account message is not something to silence.
 */
export const MUTABLE_NOTIFICATION_TYPES = [
  "like",
  "comment",
  "reply",
  "follow",
  "mention",
  "message",
  "listing_reply",
  "recipe_saved",
  "recipe_forked",
] as const;

/*
 * A PushSubscription serialised by the browser. `endpoint` is the push service
 * URL; `keys.p256dh` and `keys.auth` are the client keys we encrypt to. The
 * lengths are generous bounds against a junk payload, not a spec — a real
 * endpoint is a couple of hundred characters, a p256dh 87, an auth 22.
 */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
});

/** Notification preferences a person can change from Settings. */
export const notificationPrefSchema = z.object({
  emailDigest: z.enum(["off", "weekly", "daily"]).optional(),
  mutedTypes: z
    .array(z.enum(MUTABLE_NOTIFICATION_TYPES))
    .max(MUTABLE_NOTIFICATION_TYPES.length)
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Feedback — bug reports and feature requests                                */
/* -------------------------------------------------------------------------- */

/*
 * A dedicated form, not a contact topic. `website` is the same honeypot the
 * contact form uses, and for the same reason: this is open to signed-out
 * visitors so a bug can be reported by someone who cannot get in.
 */
export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(3, "Give it a short title.").max(MAX_FEEDBACK_TITLE),
  body: z
    .string()
    .trim()
    .min(10, "A little more detail helps us act on it.")
    .max(MAX_FEEDBACK_BODY),
  /** The page they were on. Filled in by the client, so validated leniently. */
  pageUrl: z.string().trim().max(400).nullish(),
  /** Optional reply address; the form works signed-out and anonymous. */
  email: z
    .string()
    .trim()
    .email("That does not look like an email address.")
    .max(254)
    .nullish()
    .or(z.literal("").transform(() => null)),
  website: z.string().max(200).optional(),
});

/* -------------------------------------------------------------------------- */
/* Pins — discovery-hub shortcuts                                             */
/* -------------------------------------------------------------------------- */

/*
 * A pin names one browse axis. A system must be a real slug; a tag is the same
 * shape the body parser and the tag table accept — lowercased here so a pin and
 * the tag it points at can never disagree on case.
 */
export const pinSchema = z.object({
  kind: z.enum(PIN_KINDS),
  value: z.string().trim().min(1).max(40),
});

export function normalisePin(input: {
  kind: (typeof PIN_KINDS)[number];
  value: string;
}): { kind: (typeof PIN_KINDS)[number]; value: string } | null {
  if (input.kind === "system") {
    return (GAME_SYSTEMS as readonly string[]).includes(input.value)
      ? { kind: "system", value: input.value }
      : null;
  }
  const tag = input.value.toLowerCase();
  return /^[a-z0-9_]{2,30}$/.test(tag) ? { kind: "tag", value: tag } : null;
}
