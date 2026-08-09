CREATE TABLE `commission` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`blurb` text NOT NULL,
	`price_from_pence` integer,
	`price_to_pence` integer,
	`price_unit` text DEFAULT 'model' NOT NULL,
	`turnaround_days` integer,
	`game_systems` text,
	`cover_image_id` text,
	`location` text,
	`open_to_work` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_owner_slug_unique` ON `commission` (`owner_id`,`slug`);--> statement-breakpoint
CREATE INDEX `commission_browse_idx` ON `commission` (`status`,`open_to_work`,`updated_at`);--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`low_user_id` text NOT NULL,
	`high_user_id` text NOT NULL,
	`last_message_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_message_preview` text,
	`last_sender_id` text,
	`low_read_at` integer,
	`high_read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`low_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`high_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_pair_unique` ON `conversation` (`low_user_id`,`high_user_id`);--> statement-breakpoint
CREATE INDEX `conversation_low_idx` ON `conversation` (`low_user_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `conversation_high_idx` ON `conversation` (`high_user_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `listing` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`price_pence` integer,
	`condition` text,
	`game_system` text,
	`scale` text,
	`location` text,
	`postage_offered` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`bumped_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_seller_slug_unique` ON `listing` (`seller_id`,`slug`);--> statement-breakpoint
CREATE INDEX `listing_browse_idx` ON `listing` (`kind`,`status`,`bumped_at`);--> statement-breakpoint
CREATE INDEX `listing_seller_idx` ON `listing` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `listing_system_idx` ON `listing` (`game_system`,`bumped_at`);--> statement-breakpoint
CREATE TABLE `listing_media` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`image_id` text NOT NULL,
	`width` integer,
	`height` integer,
	`alt_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listing`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listing_media_idx` ON `listing_media` (`listing_id`,`position`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_thread_idx` ON `message` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `news_item` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_item_slug_unique` ON `news_item` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `news_item_source_url_unique` ON `news_item` (`source_url`);--> statement-breakpoint
CREATE INDEX `news_item_published_idx` ON `news_item` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `news_item_category_idx` ON `news_item` (`category`,`published_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`media_id` text,
	`project_id` text,
	`author_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `post_media`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Hand-corrected. drizzle-kit generated this copy selecting `media_id` and
-- `project_id` from the OLD comment table, which does not have them: the whole
-- point of the rebuild is that they are new. Applying it fails with
-- "no such column: media_id". Every existing comment is a comment on a post,
-- so both new columns start NULL.
INSERT INTO `__new_comment`("id", "post_id", "media_id", "project_id", "author_id", "parent_id", "body", "like_count", "status", "created_at", "deleted_at") SELECT "id", "post_id", NULL, NULL, "author_id", "parent_id", "body", "like_count", "status", "created_at", "deleted_at" FROM `comment`;--> statement-breakpoint
DROP TABLE `comment`;--> statement-breakpoint
ALTER TABLE `__new_comment` RENAME TO `comment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `comment_post_idx` ON `comment` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_author_idx` ON `comment` (`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_parent_idx` ON `comment` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_media_idx` ON `comment` (`media_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_project_idx` ON `comment` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `post` ADD `project_position` integer;--> statement-breakpoint
CREATE INDEX `post_project_order_idx` ON `post` (`project_id`,`project_position`);--> statement-breakpoint
CREATE INDEX `post_liked_idx` ON `post` (`status`,`like_count`);--> statement-breakpoint
ALTER TABLE `project` ADD `comment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `pinned_post_id` text;