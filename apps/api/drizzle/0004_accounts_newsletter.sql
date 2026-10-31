CREATE TABLE `auth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_hash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `newsletter_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`format` text DEFAULT 'md' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`recipients` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `google_sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `has_password` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `newsletter_requested_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_hash_idx` ON `users` (`email_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_idx` ON `users` (`google_sub`);