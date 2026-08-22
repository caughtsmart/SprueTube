ALTER TABLE `profile` ADD `helpful_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `helpful_badge` integer DEFAULT false NOT NULL;