-- Hand-written note (ADR 0036): builds opened before these columns, or by a CLI that does not
-- send them, are `ios` with no pixel ratio. No new index: `builds_project_sha_idx` (project_id,
-- sha, created_at) already narrows the baseline lookup to a few rows before the platform filter.
-- Apply before deploying the Worker that writes them.
ALTER TABLE `builds` ADD `platform` text DEFAULT 'ios' NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `pixel_ratio` real;
