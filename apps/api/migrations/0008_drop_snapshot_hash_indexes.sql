-- Hand-written note: these indexes served the old reviewer image check, which looked a hash up
-- across snapshots. project_images replaced it (ADR 0014), so no query reads them any more and
-- every snapshot write paid for all three. Dropping an index never changes a query's result.
DROP INDEX IF EXISTS `snapshots_image_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `snapshots_baseline_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `snapshots_diff_hash_idx`;
