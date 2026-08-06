import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * SprueTube schema (Cloudflare D1 / SQLite).
 *
 * Two groups of tables:
 *   1. `user`/`session`/`account`/`verification` — owned by better-auth. The
 *      column *keys* below must keep their camelCase names; better-auth looks
 *      them up by key. SQL column names are ours to choose.
 *   2. Everything else — the SprueTube product itself.
 *
 * Counts (likeCount, followerCount, …) are denormalised. D1 has no triggers we
 * want to depend on, so every writer updates them in the same batch as the
 * row it inserts. See server/db/counters.ts.
 */

const now = sql`(unixepoch())`;

/* -------------------------------------------------------------------------- */
/* Auth (better-auth owns these)                                              */
/* -------------------------------------------------------------------------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

export const profile = sqliteTable(
  "profile",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Stored as typed; uniqueness is enforced case-insensitively below. */
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    /** Cloudflare Images ids, not URLs — the delivery host can change. */
    avatarImageId: text("avatar_image_id"),
    bannerImageId: text("banner_image_id"),
    location: text("location"),
    websiteUrl: text("website_url"),
    pronouns: text("pronouns"),
    /** JSON array of game-system slugs this painter mostly works on. */
    systems: text("systems", { mode: "json" }).$type<string[]>(),
    /**
     * Kept for the 13+ age gate required by the Online Safety Act and the App
     * Store. Format YYYY-MM-DD. Never exposed through the public API.
     */
    birthdate: text("birthdate"),
    role: text("role", { enum: ["user", "moderator", "admin"] })
      .notNull()
      .default("user"),
    status: text("status", { enum: ["active", "suspended", "deleted"] })
      .notNull()
      .default("active"),
    /** Suspension detail, shown to the user and to moderators. */
    statusReason: text("status_reason"),
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    postCount: integer("post_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("profile_username_unique").on(sql`lower(${t.username})`),
    index("profile_status_idx").on(t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Projects — build logs, the thing that makes this SprueTube and not a feed   */
/* -------------------------------------------------------------------------- */

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Unique per owner, so URLs read /@graham/projects/leviathan-crusade. */
    slug: text("slug").notNull(),
    summary: text("summary"),
    coverImageId: text("cover_image_id"),
    gameSystem: text("game_system"),
    scale: text("scale"),
    status: text("status", { enum: ["active", "finished", "abandoned"] })
      .notNull()
      .default("active"),
    postCount: integer("post_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("project_owner_slug_unique").on(t.ownerId, t.slug),
    index("project_owner_idx").on(t.ownerId, t.updatedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Posts                                                                      */
/* -------------------------------------------------------------------------- */

export const post = sqliteTable(
  "post",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: ["text", "images", "video"] }).notNull(),
    title: text("title"),
    body: text("body"),

    /* Hobby metadata. All optional — a quick photo should not need a form. */
    gameSystem: text("game_system"),
    scale: text("scale"),
    wipStage: text("wip_stage", {
      enum: [
        "sprue",
        "assembled",
        "primed",
        "basecoated",
        "shaded",
        "highlighted",
        "based",
        "finished",
      ],
    }),

    visibility: text("visibility", {
      enum: ["public", "followers", "private"],
    })
      .notNull()
      .default("public"),
    /**
     * `processing` covers video sitting in Stream's transcode queue — the post
     * exists but is not in anyone's feed until the ready webhook fires.
     */
    status: text("status", {
      enum: ["draft", "processing", "published", "removed"],
    })
      .notNull()
      .default("draft"),
    /** Blood, gore and grimdark are normal here; this just gates the blur. */
    sensitive: integer("sensitive", { mode: "boolean" })
      .notNull()
      .default(false),

    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    /** Time-decayed engagement, recomputed on write. Orders the Discover feed. */
    hotScore: real("hot_score").notNull().default(0),

    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    publishedAt: integer("published_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("post_author_idx").on(t.authorId, t.publishedAt),
    index("post_published_idx").on(t.status, t.publishedAt),
    index("post_hot_idx").on(t.status, t.hotScore),
    index("post_project_idx").on(t.projectId, t.createdAt),
    index("post_system_idx").on(t.gameSystem, t.publishedAt),
  ],
);

export const postMedia = sqliteTable(
  "post_media",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    type: text("type", { enum: ["image", "video"] }).notNull(),
    /** Cloudflare Images id (images) — combine with a variant to build a URL. */
    imageId: text("image_id"),
    /** Cloudflare Stream uid (video). */
    streamUid: text("stream_uid"),
    /** R2 key, when we keep the untouched original. */
    r2Key: text("r2_key"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: real("duration_seconds"),
    thumbnailUrl: text("thumbnail_url"),
    altText: text("alt_text"),
    status: text("status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("post_media_post_idx").on(t.postId, t.position),
    index("post_media_stream_idx").on(t.streamUid),
  ],
);

/**
 * Paints and kits named on a post. This is the quiet commercial layer: each row
 * can carry a shop URL, so "Mephiston Red" under a photo becomes a product link
 * without the post itself looking like an advert.
 */
export const postProduct = sqliteTable(
  "post_product",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: text("kind", { enum: ["paint", "kit", "tool", "other"] })
      .notNull()
      .default("paint"),
    name: text("name").notNull(),
    brand: text("brand"),
    /** Resolved at write time so the feed never has to call the shop. */
    shopUrl: text("shop_url"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("post_product_post_idx").on(t.postId, t.position)],
);

/* -------------------------------------------------------------------------- */
/* Social graph and engagement                                                */
/* -------------------------------------------------------------------------- */

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** One level of nesting only. Replies to replies attach to the parent. */
    parentId: text("parent_id"),
    body: text("body").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    status: text("status", { enum: ["published", "removed"] })
      .notNull()
      .default("published"),
    createdAt: integer("created_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("comment_post_idx").on(t.postId, t.createdAt),
    index("comment_author_idx").on(t.authorId, t.createdAt),
    index("comment_parent_idx").on(t.parentId, t.createdAt),
  ],
);

/** Likes on either posts or comments — one table, one index. */
export const like = sqliteTable(
  "like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", { enum: ["post", "comment"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subjectType, t.subjectId] }),
    index("like_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export const follow = sqliteTable(
  "follow",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followeeId: text("followee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follow_followee_idx").on(t.followeeId, t.createdAt),
  ],
);

export const bookmark = sqliteTable(
  "bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index("bookmark_user_idx").on(t.userId, t.createdAt),
  ],
);

export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    /** Always lowercase, no leading '#'. */
    name: text("name").notNull().unique(),
    postCount: integer("post_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("tag_popular_idx").on(t.postCount)],
);

export const postTag = sqliteTable(
  "post_tag",
  {
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index("post_tag_tag_idx").on(t.tagId),
  ],
);

export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    type: text("type", {
      enum: ["like", "comment", "reply", "follow", "mention", "system"],
    }).notNull(),
    subjectType: text("subject_type", { enum: ["post", "comment", "user"] }),
    subjectId: text("subject_id"),
    /** Short pre-rendered line, so the list needs no extra joins. */
    preview: text("preview"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Trust and safety                                                           */
/* -------------------------------------------------------------------------- */

export const report = sqliteTable(
  "report",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").references(() => user.id, {
      onDelete: "set null",
    }),
    subjectType: text("subject_type", {
      enum: ["post", "comment", "user"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    reason: text("reason", {
      enum: [
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
      ],
    }).notNull(),
    details: text("details"),
    status: text("status", { enum: ["open", "actioned", "dismissed"] })
      .notNull()
      .default("open"),
    /**
     * child_safety, violence and illegal jump the queue. The Online Safety Act
     * expects illegal content to be handled swiftly, not in report order.
     */
    priority: integer("priority").notNull().default(0),
    handledBy: text("handled_by").references(() => user.id, {
      onDelete: "set null",
    }),
    handledAt: integer("handled_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("report_status_idx").on(t.status, t.priority, t.createdAt),
    index("report_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export const block = sqliteTable(
  "block",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("block_blocked_idx").on(t.blockedId),
  ],
);

/** Softer than a block: their posts leave your feeds, nothing else changes. */
export const mute = sqliteTable(
  "mute",
  {
    muterId: text("muter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mutedId: text("muted_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.muterId, t.mutedId] })],
);

/** Append-only audit trail. Never updated, never deleted. */
export const moderationAction = sqliteTable(
  "moderation_action",
  {
    id: text("id").primaryKey(),
    moderatorId: text("moderator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action", {
      enum: [
        "remove_post",
        "restore_post",
        "remove_comment",
        "restore_comment",
        "suspend_user",
        "unsuspend_user",
        "dismiss_report",
        "mark_sensitive",
      ],
    }).notNull(),
    subjectType: text("subject_type", {
      enum: ["post", "comment", "user"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    reportId: text("report_id"),
    reason: text("reason"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("moderation_action_subject_idx").on(t.subjectType, t.subjectId),
    index("moderation_action_created_idx").on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Advertising                                                                */
/* -------------------------------------------------------------------------- */

/**
 * House ads. These fill every slot until AdSense approves the domain, and stay
 * on afterwards as the fallback when the network returns nothing — an empty ad
 * slot is worse than a Loaded Dice promo.
 */
export const adPlacement = sqliteTable(
  "ad_placement",
  {
    id: text("id").primaryKey(),
    slot: text("slot", { enum: ["feed", "sidebar", "post"] }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    imageUrl: text("image_url"),
    targetUrl: text("target_url").notNull(),
    ctaLabel: text("cta_label"),
    /** Relative share of impressions among the active ads for a slot. */
    weight: integer("weight").notNull().default(1),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    startsAt: integer("starts_at"),
    endsAt: integer("ends_at"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("ad_placement_slot_idx").on(t.slot, t.active)],
);

/* -------------------------------------------------------------------------- */
/* Native app support                                                         */
/* -------------------------------------------------------------------------- */

/** APNs / FCM tokens. Unused by the web app; here so iOS needs no migration. */
export const pushToken = sqliteTable(
  "push_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at").notNull().default(now),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
  },
  (t) => [index("push_token_user_idx").on(t.userId)],
);

export type User = typeof user.$inferSelect;
export type Profile = typeof profile.$inferSelect;
export type Post = typeof post.$inferSelect;
export type PostMedia = typeof postMedia.$inferSelect;
export type PostProduct = typeof postProduct.$inferSelect;
export type Project = typeof project.$inferSelect;
export type Comment = typeof comment.$inferSelect;
export type Notification = typeof notification.$inferSelect;
export type Report = typeof report.$inferSelect;
export type AdPlacement = typeof adPlacement.$inferSelect;
