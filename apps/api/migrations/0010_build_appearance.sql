-- Hand-written note (ADR 0035): builds opened before this column, or by a CLI that does not send
-- an appearance, get NULL. Apply before deploying the Worker that writes it.
ALTER TABLE `builds` ADD `appearance` text;
