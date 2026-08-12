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
    recipeCount: integer("recipe_count").notNull().default(0),
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
    commentCount: integer("comment_count").notNull().default(0),
    /**
     * The "where it is now" entry, held at the top.
     *
     * A build log reads oldest-first, which is right for the story and wrong
     * for the question most visitors actually arrive with — what does it look
     * like today? The pin answers that without reordering the history.
     *
     * No foreign key reference here: the post table is declared after this one,
     * and a circular reference between two table definitions is a bootstrapping
     * problem in Drizzle. Integrity is enforced on write instead — the pin is
     * cleared when the post it names is deleted.
     */
    pinnedPostId: text("pinned_post_id"),
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
    /**
     * Manual order within a build log. Null means "wherever the date puts it".
     *
     * Sparse on purpose: only entries someone has actually dragged get a value,
     * and the query sorts by this first with a date fallback. Backfilling every
     * row on the first drag would make an ordinary edit rewrite the whole log.
     */
    projectPosition: integer("project_position"),
    kind: text("kind", { enum: ["text", "images"] }).notNull(),
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
    status: text("status", {
      enum: ["draft", "published", "removed"],
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
    index("post_project_order_idx").on(t.projectId, t.projectPosition),
    // Most-liked, for the homepage highlights. Without this the query is a
    // full scan sorted in memory, which is fine at 100 posts and not at 100k.
    index("post_liked_idx").on(t.status, t.likeCount),
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
    /** Cloudflare Images id — combine with a variant name to build a URL. */
    imageId: text("image_id").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("post_media_post_idx").on(t.postId, t.position)],
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

/*
 * Comments hang off one of three things, and exactly one is set:
 *
 *   postId  alone          — the post as a whole (every comment before this)
 *   postId  + mediaId      — one photograph inside a post
 *   projectId alone        — the build log itself
 *
 * postId had to become nullable to allow the third case. The invariant is
 * enforced on write rather than by a constraint, because SQLite CHECKs cannot
 * be added to an existing table without a rebuild and the rule is more legible
 * in one place in the service than split across a migration.
 */
export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").references(() => post.id, { onDelete: "cascade" }),
    /** Set when the comment is about one image rather than the whole post. */
    mediaId: text("media_id").references(() => postMedia.id, {
      onDelete: "cascade",
    }),
    /** Set when the comment is about a build log rather than a post. */
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
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
    index("comment_media_idx").on(t.mediaId, t.createdAt),
    index("comment_project_idx").on(t.projectId, t.createdAt),
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
      enum: [
        "like",
        "comment",
        "reply",
        "follow",
        "mention",
        "system",
        "message",
        "listing_reply",
        "recipe_saved",
        "recipe_forked",
      ],
    }).notNull(),
    subjectType: text("subject_type", {
      enum: ["post", "comment", "user", "project", "listing", "message", "recipe"],
    }),
    subjectId: text("subject_id"),
    /** Short pre-rendered line, so the list needs no extra joins. */
    preview: text("preview"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Notification delivery: preferences and push subscriptions                  */
/* -------------------------------------------------------------------------- */

/*
 * One row per person, created lazily the first time they touch a notification
 * setting. Absence means defaults, so no existing account needs a backfill and
 * anyone who never opts in behaves exactly as before — in-app only.
 *
 * `mutedTypes` is a JSON array of notification `type` values the person never
 * wants pushed or digested. It reuses the enum on `notification` above rather
 * than inventing a second taxonomy; in-app notifications ignore it.
 */
export const notificationPref = sqliteTable("notification_pref", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Master switch for Web Push. Off until the person grants it. */
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Email digest cadence. Reserved for the digest work; unused by push. */
  emailDigest: text("email_digest", { enum: ["off", "weekly", "daily"] })
    .notNull()
    .default("weekly"),
  /** JSON array of muted notification `type` values, e.g. ["like"]. */
  mutedTypes: text("muted_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** Watermark for the digest job, so it never repeats a notification. */
  digestLastSentAt: integer("digest_last_sent_at"),
  updatedAt: integer("updated_at").notNull().default(now),
});

/*
 * A person has many subscriptions — one per browser or device. This is the
 * table the roadmap calls "the push-token table", in its Web Push form: a
 * native APNs/FCM sibling would sit alongside it later.
 *
 * `endpoint` is unique so re-subscribing the same browser upserts rather than
 * piling up dead rows. `p256dh` and `auth` are the client's keys, needed to
 * encrypt the payload per RFC 8291.
 */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** So a person can recognise "Firefox on the laptop" in a device list. */
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(now),
    lastSuccessAt: integer("last_success_at"),
    /** Consecutive failed sends; the row is pruned once it climbs too high. */
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => [index("push_subscription_user_idx").on(t.userId)],
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
      enum: ["post", "comment", "user", "project", "listing", "message"],
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
      enum: ["post", "comment", "user", "project", "listing", "message"],
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

export type User = typeof user.$inferSelect;
export type Profile = typeof profile.$inferSelect;
export type Post = typeof post.$inferSelect;
export type PostMedia = typeof postMedia.$inferSelect;
export type PostProduct = typeof postProduct.$inferSelect;
export type Project = typeof project.$inferSelect;
export type Comment = typeof comment.$inferSelect;
export type Notification = typeof notification.$inferSelect;
export type NotificationPref = typeof notificationPref.$inferSelect;
export type PushSubscription = typeof pushSubscription.$inferSelect;
export type Report = typeof report.$inferSelect;
export type AdPlacement = typeof adPlacement.$inferSelect;

/* -------------------------------------------------------------------------- */
/* News                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Short, source-attributed hobby news.
 *
 * Every row is a summary of something somebody else published, with a link
 * back. Nothing here is original reporting and the schema says so: `sourceUrl`
 * and `sourceName` are not nullable, so an item that cannot say where it came
 * from cannot be stored. That is the guardrail against a daily job quietly
 * inventing news, which is the failure mode this feature invites.
 */
export const newsItem = sqliteTable(
  "news_item",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** A few sentences. Not the source article — a pointer to it. */
    summary: text("summary").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    /**
     * The brief is half Warhammer, half everything else, so the balance has to
     * be measurable rather than hoped for.
     */
    category: text("category", { enum: ["warhammer", "wider"] }).notNull(),
    status: text("status", { enum: ["published", "hidden"] })
      .notNull()
      .default("published"),
    /** From the feed, not from us — so ordering matches the real world. */
    publishedAt: integer("published_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("news_item_slug_unique").on(t.slug),
    // The ingest runs daily and feeds repeat themselves; this is what makes
    // "have we already got this one?" a lookup rather than a scan.
    uniqueIndex("news_item_source_url_unique").on(t.sourceUrl),
    index("news_item_published_idx").on(t.status, t.publishedAt),
    index("news_item_category_idx").on(t.category, t.publishedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Commissions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A painter advertising that they take work.
 *
 * Prices are stored in pence as integers. Money in floats is a bug waiting for
 * a quiet afternoon, and £47.99 is not representable in binary floating point.
 */
export const commission = sqliteTable(
  "commission",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    blurb: text("blurb").notNull(),
    /** Pence. Null means "ask" rather than free. */
    priceFromPence: integer("price_from_pence"),
    priceToPence: integer("price_to_pence"),
    /** What the price is per — a model, a unit, an army. */
    priceUnit: text("price_unit", {
      enum: ["model", "unit", "army", "hour", "project"],
    })
      .notNull()
      .default("model"),
    turnaroundDays: integer("turnaround_days"),
    gameSystems: text("game_systems", { mode: "json" }).$type<string[]>(),
    coverImageId: text("cover_image_id"),
    location: text("location"),
    /**
     * Whether they are taking work right now. A painter with a full book wants
     * to stay listed and stop the enquiries, not delete their listing and
     * rebuild it in March.
     */
    openToWork: integer("open_to_work", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", { enum: ["active", "hidden", "removed"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("commission_owner_slug_unique").on(t.ownerId, t.slug),
    index("commission_browse_idx").on(t.status, t.openToWork, t.updatedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Marketplace                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Classified ads — models for sale, and wanted posts.
 *
 * Listings and contact only. No payments, no escrow, no fee: the moment money
 * moves through the platform it becomes a marketplace in the legal sense, with
 * the consumer-protection and dispute obligations that follow. People arrange
 * between themselves, exactly as they do in a club or on a forum.
 */
export const listing = sqliteTable(
  "listing",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["sale", "wanted"] }).notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Pence. Null on a wanted post, or on "offers". */
    pricePence: integer("price_pence"),
    condition: text("condition", {
      enum: ["new_sealed", "new_sprue", "part_built", "painted", "damaged"],
    }),
    gameSystem: text("game_system"),
    scale: text("scale"),
    /** Free text, deliberately coarse — a town, not an address. */
    location: text("location"),
    postageOffered: integer("postage_offered", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["open", "sold", "withdrawn", "removed"],
    })
      .notNull()
      .default("open"),
    viewCount: integer("view_count").notNull().default(0),
    /**
     * Sorting key, separate from createdAt so a seller can bump a stale listing
     * without it claiming to be new.
     */
    bumpedAt: integer("bumped_at").notNull().default(now),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("listing_seller_slug_unique").on(t.sellerId, t.slug),
    index("listing_browse_idx").on(t.kind, t.status, t.bumpedAt),
    index("listing_seller_idx").on(t.sellerId, t.createdAt),
    index("listing_system_idx").on(t.gameSystem, t.bumpedAt),
  ],
);

export const listingMedia = sqliteTable(
  "listing_media",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listing.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    imageId: text("image_id").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("listing_media_idx").on(t.listingId, t.position)],
);

/* -------------------------------------------------------------------------- */
/* Direct messages                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A one-to-one thread.
 *
 * The two participants are stored as `lowUserId` / `highUserId`, sorted by
 * string comparison before insert. That makes the pair a natural unique key —
 * without it, "did a thread between these two already exist?" has to be asked
 * twice, and losing that race creates two threads that each hold half of a
 * conversation.
 */
export const conversation = sqliteTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    lowUserId: text("low_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    highUserId: text("high_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Denormalised so an inbox is one query, not one query per thread. */
    lastMessageAt: integer("last_message_at").notNull().default(now),
    lastMessagePreview: text("last_message_preview"),
    lastSenderId: text("last_sender_id"),
    /** Per-side read cursors, so "unread" is answerable without a scan. */
    lowReadAt: integer("low_read_at"),
    highReadAt: integer("high_read_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("conversation_pair_unique").on(t.lowUserId, t.highUserId),
    index("conversation_low_idx").on(t.lowUserId, t.lastMessageAt),
    index("conversation_high_idx").on(t.highUserId, t.lastMessageAt),
  ],
);

export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /**
     * Soft delete, like posts. A reported message has to still exist for a
     * moderator to read, or every report becomes unactionable the moment the
     * sender thinks better of it.
     */
    status: text("status", { enum: ["sent", "removed"] })
      .notNull()
      .default("sent"),
    createdAt: integer("created_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("message_thread_idx").on(t.conversationId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Recipes — reusable, shoppable paint schemes (see docs/RECIPES.md)           */
/* -------------------------------------------------------------------------- */

/**
 * A paint scheme owned by a painter, not by a post — so it can be written from
 * scratch, shown on many posts, and (later) saved and forked. The flat
 * `post_product` list stays for a quick "paints used" under one photo; a recipe
 * is the documented, reusable version.
 */
export const recipe = sqliteTable(
  "recipe",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Unique per owner, like a project slug. Lives at /@user/recipes/:slug. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    gameSystem: text("game_system"),
    scale: text("scale"),
    coverImageId: text("cover_image_id"),
    visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
      .notNull()
      .default("public"),
    /**
     * Set when this recipe was forked from another. No foreign key on purpose —
     * the same call `project.pinnedPostId` makes — so a fork outlives its origin
     * being deleted, showing a degraded credit rather than cascading away.
     * Declared now; the fork flow that fills it is a later phase.
     */
    forkedFromId: text("forked_from_id"),
    saveCount: integer("save_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    /** Posts that attach this recipe. */
    useCount: integer("use_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("recipe_owner_slug_unique").on(t.ownerId, t.slug),
    index("recipe_owner_idx").on(t.ownerId, t.createdAt),
    index("recipe_system_idx").on(t.gameSystem, t.createdAt),
  ],
);

export const recipeStep = sqliteTable(
  "recipe_step",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /*
     * The technique vocabulary is inlined here rather than imported from
     * taxonomy, the same call `post.wipStage` makes: importing the tuple would
     * pull this Drizzle schema toward the client bundle the taxonomy split
     * exists to keep it out of. Keep this list and TECHNIQUES in step.
     */
    technique: text("technique", {
      enum: [
        "prime",
        "base",
        "layer",
        "wash",
        "shade",
        "drybrush",
        "edge_highlight",
        "glaze",
        "wet_blend",
        "weathering",
        "other",
      ],
    }).notNull(),
    /** Null for a pure-technique step ("stipple with a torn sponge"). */
    productName: text("product_name"),
    brand: text("brand"),
    /** Resolved at write time, exactly like `post_product.shopUrl`. */
    shopUrl: text("shop_url"),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("recipe_step_recipe_idx").on(t.recipeId, t.position)],
);

/**
 * A recipe shown on a post. A join, not a column on `post`, so the hot post
 * table is untouched and a diorama can credit more than one scheme later.
 */
export const postRecipe = sqliteTable(
  "post_recipe",
  {
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.recipeId] }),
    // "Which posts use this recipe" — the reverse of the primary key.
    index("post_recipe_recipe_idx").on(t.recipeId),
  ],
);

/**
 * A recipe kept in someone's collection. Idempotent by its composite key, the
 * same shape as `like`, so a double-save cannot inflate `save_count`.
 */
export const recipeSave = sqliteTable(
  "recipe_save",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.userId] }),
    // A person's saved recipes, newest first.
    index("recipe_save_user_idx").on(t.userId, t.createdAt),
  ],
);
