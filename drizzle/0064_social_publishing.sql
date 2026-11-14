CREATE TABLE "social_ai_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"mode" text NOT NULL,
	"length" text,
	"input" text DEFAULT '' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_auto_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text DEFAULT 'Untitled preset' NOT NULL,
	"days_of_week" text DEFAULT '1,2,3,4,5' NOT NULL,
	"time_of_day" text DEFAULT '09:00' NOT NULL,
	"providers" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'generate' NOT NULL,
	"seed_prompt" text DEFAULT '' NOT NULL,
	"topics" text DEFAULT '' NOT NULL,
	"product_id" text,
	"image_mode" text DEFAULT 'none' NOT NULL,
	"video_mode" text DEFAULT 'none' NOT NULL,
	"image_set" text DEFAULT '' NOT NULL,
	"links" text DEFAULT '' NOT NULL,
	"link_utm" boolean DEFAULT false NOT NULL,
	"review_first" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_auto_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text DEFAULT 'Queue' NOT NULL,
	"days_of_week" text DEFAULT '1,2,3,4,5' NOT NULL,
	"time_of_day" text DEFAULT '09:00' NOT NULL,
	"timezone" text,
	"providers" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'queue' NOT NULL,
	"seed_prompt" text DEFAULT '' NOT NULL,
	"topics" text DEFAULT '' NOT NULL,
	"topic_cursor" integer DEFAULT 0 NOT NULL,
	"links" text DEFAULT '' NOT NULL,
	"link_cursor" integer DEFAULT 0 NOT NULL,
	"link_utm" boolean DEFAULT false NOT NULL,
	"product_id" text,
	"image_mode" text DEFAULT 'none' NOT NULL,
	"video_mode" text DEFAULT 'none' NOT NULL,
	"image_set" text DEFAULT '' NOT NULL,
	"image_cursor" integer DEFAULT 0 NOT NULL,
	"review_first" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"provider" text NOT NULL,
	"label" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"external_id" text,
	"display_name" text,
	"scope" text,
	"ai_context" text,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_media" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"post_id" text,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text,
	"label" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"metrics" jsonb,
	"metrics_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"text" text DEFAULT '' NOT NULL,
	"link" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"providers" text DEFAULT '' NOT NULL,
	"per_network" jsonb,
	"favorite" boolean DEFAULT false NOT NULL,
	"auto_image" boolean DEFAULT false NOT NULL,
	"auto_video" boolean DEFAULT false NOT NULL,
	"auto_gif" boolean DEFAULT false NOT NULL,
	"merge_media_id" text,
	"share_token" text,
	"funnel_id" text,
	"funnel_stage_id" text,
	"auto_post_rule_id" text,
	"short_rule_id" text,
	"render_id" text,
	"export_id" text,
	"approval_status" text DEFAULT 'none' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_shareToken_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "social_snippets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "social_approver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_presets" ADD CONSTRAINT "social_auto_presets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_presets" ADD CONSTRAINT "social_auto_presets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_rules" ADD CONSTRAINT "social_auto_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_rules" ADD CONSTRAINT "social_auto_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_export_id_export_jobs_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."export_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_snippets" ADD CONSTRAINT "social_snippets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_snippets" ADD CONSTRAINT "social_snippets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_auto_rules_active_next_idx" ON "social_auto_rules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "social_connections_ws_provider_idx" ON "social_connections" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "social_media_post_idx" ON "social_media" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_media_ws_idx" ON "social_media" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_post_idx" ON "social_post_targets" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_status_retry_idx" ON "social_post_targets" USING btree ("status","retry_at");--> statement-breakpoint
CREATE INDEX "social_posts_ws_status_idx" ON "social_posts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "social_posts_status_scheduled_idx" ON "social_posts" USING btree ("status","scheduled_at");
