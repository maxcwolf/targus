CREATE TABLE `org_memberships` (
	`user_id` text NOT NULL,
	`org_id` text NOT NULL,
	`member` integer NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `org_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `org_memberships_org_id_idx` ON `org_memberships` (`org_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);--> statement-breakpoint
ALTER TABLE `builds` ADD `pending_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `denied_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `unchanged_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `changed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `new_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `removed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `unstable_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `error_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `title` text;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `name` text;--> statement-breakpoint
CREATE INDEX `snapshots_image_hash_idx` ON `snapshots` (`image_hash`);--> statement-breakpoint
CREATE INDEX `snapshots_baseline_hash_idx` ON `snapshots` (`baseline_hash`);--> statement-breakpoint
CREATE INDEX `snapshots_diff_hash_idx` ON `snapshots` (`diff_hash`);