CREATE TABLE `card_items` (
	`user_id` integer NOT NULL,
	`entry_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`module` text NOT NULL,
	`box` integer DEFAULT 1 NOT NULL,
	`due_day` text NOT NULL,
	`reviews` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `entry_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_items_due` ON `card_items` (`user_id`,`module`,`due_day`);--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `last_recap_week` text;--> statement-breakpoint
ALTER TABLE `users` ADD `weekly_recap` integer DEFAULT true NOT NULL;