-- Hand-written note (ADR 0015): sessions now store the SHA-256 of the session id (`id_hash`),
-- not the id itself. D1's SQL has no SHA-256 function, so the old rows cannot be converted in a
-- migration; the table is dropped and recreated instead. EVERY EXISTING SESSION ENDS when this
-- migration is applied: each reviewer signs in with GitHub once more. Nothing references
-- sessions, so nothing else is lost.
DROP TABLE `sessions`;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);