CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"story_id" text NOT NULL,
	"variant" text NOT NULL,
	"from_hash" text,
	"to_hash" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"sha" text NOT NULL,
	"branch" text NOT NULL,
	"pr_number" integer,
	"merge_base_sha" text,
	"baseline_build_id" text,
	"trigger" text NOT NULL,
	"device" text NOT NULL,
	"appearance" text,
	"platform" text DEFAULT 'ios' NOT NULL,
	"pixel_ratio" double precision,
	"status" text NOT NULL,
	"check_run_id" bigint,
	"created_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"review_version" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"denied_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"unstable_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"results_digest" text
);
--> statement-breakpoint
CREATE TABLE "images" (
	"hash" text PRIMARY KEY NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"last_referenced_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"member" boolean NOT NULL,
	"checked_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "org_memberships_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"github_org" text NOT NULL,
	"installation_id" bigint,
	"github_account_id" bigint,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "orgs_github_org_unique" UNIQUE("github_org")
);
--> statement-breakpoint
CREATE TABLE "project_images" (
	"project_id" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "project_images_project_id_hash_pk" PRIMARY KEY("project_id","hash")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"repo" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"story_id" text NOT NULL,
	"variant" text NOT NULL,
	"title" text,
	"name" text,
	"image_hash" text,
	"width" integer,
	"height" integer,
	"baseline_hash" text,
	"diff_hash" text,
	"diff_ratio" double precision,
	"state" text NOT NULL,
	"review" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp (3) with time zone,
	"blank" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"last_login_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_images" ADD CONSTRAINT "project_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_identity_unique" ON "approvals" USING btree ("project_id","story_id","variant","from_hash","to_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_new_story_identity_unique" ON "approvals" USING btree ("project_id","story_id","variant","to_hash") WHERE "approvals"."from_hash" IS NULL;--> statement-breakpoint
CREATE INDEX "builds_project_sha_idx" ON "builds" USING btree ("project_id","sha","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "builds_project_number_unique" ON "builds" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "builds_baseline_build_id_idx" ON "builds" USING btree ("baseline_build_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builds_project_idempotency_key_unique" ON "builds" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "images_last_referenced_at_idx" ON "images" USING btree ("last_referenced_at");--> statement-breakpoint
CREATE INDEX "org_memberships_org_id_idx" ON "org_memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projects_org_id_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_repo_unique" ON "projects" USING btree ("repo");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_token_hash_unique" ON "projects" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_build_story_variant_unique" ON "snapshots" USING btree ("build_id","story_id","variant");