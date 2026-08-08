import { z } from "zod";
import {
  GAME_SYSTEMS,
  MAX_BODY_LENGTH,
  MAX_IMAGES_PER_POST,
  PROJECT_STATUSES,
  REPORT_REASONS,
  SCALES,
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

export const reportSchema = z.object({
  subjectType: z.enum(["post", "comment", "user"]),
  subjectId: z.string().min(1).max(60),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).nullish(),
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
