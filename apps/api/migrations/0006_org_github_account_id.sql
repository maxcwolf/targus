-- Hand-written note (ADR 0024): existing orgs get a NULL account id. It is not backfilled from
-- `github_org`, since a login can change hands; the API reads it from the org's App installation
-- the next time a reviewer's access to the org is checked, and denies access until it can.
ALTER TABLE `orgs` ADD `github_account_id` integer;
