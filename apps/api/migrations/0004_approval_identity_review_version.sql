DROP INDEX `approvals_project_story_hashes_idx`;--> statement-breakpoint
-- Dedupe (hand-written, before the unique indexes): the old index was not unique, so a hash
-- pair approved twice has two rows. Keep the earliest of each identity; `IS` also matches two
-- NULL from_hash values (approvals of a `new` story), which `=` would not.
DELETE FROM `approvals` WHERE EXISTS (
	SELECT 1 FROM `approvals` AS `kept`
	WHERE `kept`.`project_id` = `approvals`.`project_id`
		AND `kept`.`story_id` = `approvals`.`story_id`
		AND `kept`.`variant` = `approvals`.`variant`
		AND `kept`.`from_hash` IS `approvals`.`from_hash`
		AND `kept`.`to_hash` = `approvals`.`to_hash`
		AND (
			`kept`.`approved_at` < `approvals`.`approved_at`
			OR (`kept`.`approved_at` = `approvals`.`approved_at` AND `kept`.`id` < `approvals`.`id`)
		)
);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_identity_unique` ON `approvals` (`project_id`,`story_id`,`variant`,`from_hash`,`to_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_new_story_identity_unique` ON `approvals` (`project_id`,`story_id`,`variant`,`to_hash`) WHERE "approvals"."from_hash" IS NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `review_version` integer DEFAULT 0 NOT NULL;