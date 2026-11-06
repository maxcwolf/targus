CREATE TABLE `project_images` (
	`project_id` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `hash`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Backfill (hand-written): every image an existing snapshot uses was sent by its own project,
-- as a capture, as the baseline it was compared against, or as the diff of the two.
INSERT OR IGNORE INTO `project_images` (`project_id`, `hash`, `created_at`)
SELECT `builds`.`project_id`, `snapshots`.`image_hash`, `builds`.`created_at`
FROM `snapshots` INNER JOIN `builds` ON `builds`.`id` = `snapshots`.`build_id`
WHERE `snapshots`.`image_hash` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_images` (`project_id`, `hash`, `created_at`)
SELECT `builds`.`project_id`, `snapshots`.`baseline_hash`, `builds`.`created_at`
FROM `snapshots` INNER JOIN `builds` ON `builds`.`id` = `snapshots`.`build_id`
WHERE `snapshots`.`baseline_hash` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_images` (`project_id`, `hash`, `created_at`)
SELECT `builds`.`project_id`, `snapshots`.`diff_hash`, `builds`.`created_at`
FROM `snapshots` INNER JOIN `builds` ON `builds`.`id` = `snapshots`.`build_id`
WHERE `snapshots`.`diff_hash` IS NOT NULL;
