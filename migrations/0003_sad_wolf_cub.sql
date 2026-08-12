CREATE TABLE `post_recipe` (
	`post_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`post_id`, `recipe_id`),
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_recipe_recipe_idx` ON `post_recipe` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`game_system` text,
	`scale` text,
	`cover_image_id` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`forked_from_id` text,
	`save_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_owner_slug_unique` ON `recipe` (`owner_id`,`slug`);--> statement-breakpoint
CREATE INDEX `recipe_owner_idx` ON `recipe` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recipe_system_idx` ON `recipe` (`game_system`,`created_at`);--> statement-breakpoint
CREATE TABLE `recipe_step` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`technique` text NOT NULL,
	`product_name` text,
	`brand` text,
	`shop_url` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_step_recipe_idx` ON `recipe_step` (`recipe_id`,`position`);--> statement-breakpoint
ALTER TABLE `profile` ADD `recipe_count` integer DEFAULT 0 NOT NULL;