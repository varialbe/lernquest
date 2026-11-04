ALTER TABLE `users` ADD `locale` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_locale` text DEFAULT 'en' NOT NULL;