-- Hand-written note (ADR 0027): existing builds get a NULL key, and SQLite treats NULLs as
-- distinct in a unique index, so they never collide. Apply before deploying the Worker that
-- writes the column.
ALTER TABLE `builds` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `builds_project_idempotency_key_unique` ON `builds` (`project_id`,`idempotency_key`);