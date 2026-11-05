CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`variant` text NOT NULL,
	`from_hash` text,
	`to_hash` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approvals_project_story_hashes_idx` ON `approvals` (`project_id`,`story_id`,`variant`,`from_hash`,`to_hash`);--> statement-breakpoint
CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`sha` text NOT NULL,
	`branch` text NOT NULL,
	`pr_number` integer,
	`merge_base_sha` text,
	`baseline_build_id` text,
	`trigger` text NOT NULL,
	`device` text NOT NULL,
	`status` text NOT NULL,
	`check_run_id` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `builds_project_sha_idx` ON `builds` (`project_id`,`sha`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `builds_project_number_unique` ON `builds` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `builds_baseline_build_id_idx` ON `builds` (`baseline_build_id`);--> statement-breakpoint
CREATE TABLE `images` (
	`hash` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_referenced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `images_last_referenced_at_idx` ON `images` (`last_referenced_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`story_id` text NOT NULL,
	`variant` text NOT NULL,
	`image_hash` text,
	`width` integer,
	`height` integer,
	`baseline_hash` text,
	`diff_hash` text,
	`diff_ratio` real,
	`state` text NOT NULL,
	`review` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`blank` integer DEFAULT false NOT NULL,
	`error` text,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_build_story_variant_unique` ON `snapshots` (`build_id`,`story_id`,`variant`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_token_hash_unique` ON `projects` (`token_hash`);