ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `newsletter` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `newsletter_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `privacy_accepted_at` integer;