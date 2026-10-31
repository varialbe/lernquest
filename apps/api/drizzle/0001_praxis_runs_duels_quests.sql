CREATE TABLE `duels` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`question_ids` text NOT NULL,
	`challenger_id` integer NOT NULL,
	`opponent_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`winner_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`challenger_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opponent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `duels_challenger_idx` ON `duels` (`challenger_id`);--> statement-breakpoint
CREATE INDEX `duels_opponent_idx` ON `duels` (`opponent_id`);--> statement-breakpoint
CREATE TABLE `quest_claims` (
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`quest_id` text NOT NULL,
	`coins` integer NOT NULL,
	`claimed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `quest_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quiz_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`module` text,
	`question_ids` text NOT NULL,
	`duel_id` text,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`correct` integer,
	`total` integer,
	`duration_sec` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_runs_user_idx` ON `quiz_runs` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `quiz_runs_duel_idx` ON `quiz_runs` (`duel_id`);