-- Hand-written note (ADR 0031): builds completed before this column get NULL, so a resend of
-- their results stays a conflict, as before. Apply before deploying the Worker that writes it.
ALTER TABLE `builds` ADD `results_digest` text;
