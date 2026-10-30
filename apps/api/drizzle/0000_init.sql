CREATE TABLE `admin_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`correct` integer NOT NULL,
	`context` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `answers_user_idx` ON `answers` (`user_id`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`code` text PRIMARY KEY NOT NULL,
	`created_by` integer,
	`note` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `league_weeks` (
	`week_start` text PRIMARY KEY NOT NULL,
	`processed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`result` text
);
--> statement-breakpoint
CREATE TABLE `level_progress` (
	`user_id` integer NOT NULL,
	`level_id` text NOT NULL,
	`completions` integer DEFAULT 0 NOT NULL,
	`best_accuracy` integer DEFAULT 0 NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`first_done_at` integer,
	`last_done_at` integer,
	PRIMARY KEY(`user_id`, `level_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `levels_unit_idx` ON `levels` (`unit_id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`summary` text,
	`report` text
);
--> statement-breakpoint
CREATE TABLE `pipeline_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processed_files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`unit_id` text,
	`error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`run_id` text,
	`processed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`price` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`last_reminded_day` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `question_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`question_id` text NOT NULL,
	`reason` text NOT NULL,
	`comment` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` integer,
	`resolved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`level_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`disabled_by_admin` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_level_idx` ON `questions` (`level_id`);--> statement-breakpoint
CREATE TABLE `review_items` (
	`user_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`box` integer DEFAULT 1 NOT NULL,
	`due_day` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`number` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`concepts` text NOT NULL,
	`key_facts` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`source_file` text NOT NULL,
	`source_sha` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_module_number` ON `units` (`module`,`number`);--> statement-breakpoint
CREATE TABLE `user_pets` (
	`user_id` integer NOT NULL,
	`pet_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`accessory` text,
	`acquired_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `pet_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`unlock_all` integer DEFAULT false NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_active_day` text,
	`streak_freezes` integer DEFAULT 0 NOT NULL,
	`daily_goal` integer DEFAULT 30 NOT NULL,
	`league_tier` integer DEFAULT 0 NOT NULL,
	`theme` text DEFAULT 'default' NOT NULL,
	`frame` text,
	`sound_on` integer DEFAULT true NOT NULL,
	`active_pet` text,
	`invited_with` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `xp_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`module` text,
	`source` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `xp_user_day` ON `xp_events` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `xp_created` ON `xp_events` (`created_at`);