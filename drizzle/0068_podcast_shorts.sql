CREATE TABLE "podcast_episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"post_id" text,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"audio_media_id" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"image_media_id" text,
	"link" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_episodes_guid_unique" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "podcast_listens" (
	"show_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"day" text NOT NULL,
	"client_hash" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"app" text,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcast_shows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"author" text,
	"language" text DEFAULT 'en-us' NOT NULL,
	"category" text DEFAULT 'Technology' NOT NULL,
	"subcategory" text,
	"explicit" boolean DEFAULT false NOT NULL,
	"link" text,
	"cover_media_id" text,
	"copyright" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_shows_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "short_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"solution_filter" text DEFAULT '' NOT NULL,
	"solution_cursor" integer DEFAULT 0 NOT NULL,
	"seed_prompt" text DEFAULT '' NOT NULL,
	"topics" text DEFAULT '' NOT NULL,
	"topic_cursor" integer DEFAULT 0 NOT NULL,
	"days_of_week" text DEFAULT '1,2,3,4,5' NOT NULL,
	"time_of_day" text DEFAULT '09:00' NOT NULL,
	"timezone" text,
	"providers" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"review_first" boolean DEFAULT true NOT NULL,
	"migration_hold" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_render_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"post_id" text,
	"kind" text NOT NULL,
	"rule_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"charge_id" text,
	"finalized_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_render_jobs_kind_check" CHECK ("social_render_jobs"."kind" in ('explainer', 'short'))
);
--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_show_id_podcast_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."podcast_shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_audio_media_id_social_media_id_fk" FOREIGN KEY ("audio_media_id") REFERENCES "public"."social_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_image_media_id_social_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."social_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_listens" ADD CONSTRAINT "podcast_listens_show_id_podcast_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."podcast_shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_listens" ADD CONSTRAINT "podcast_listens_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_shows" ADD CONSTRAINT "podcast_shows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_shows" ADD CONSTRAINT "podcast_shows_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_shows" ADD CONSTRAINT "podcast_shows_cover_media_id_social_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."social_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_rules" ADD CONSTRAINT "short_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_rules" ADD CONSTRAINT "short_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_render_jobs" ADD CONSTRAINT "social_render_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_render_jobs" ADD CONSTRAINT "social_render_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_render_jobs" ADD CONSTRAINT "social_render_jobs_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_render_jobs" ADD CONSTRAINT "social_render_jobs_charge_id_generation_jobs_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "podcast_episodes_feed_idx" ON "podcast_episodes" USING btree ("show_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_listens_pk" ON "podcast_listens" USING btree ("episode_id","day","client_hash");--> statement-breakpoint
CREATE INDEX "podcast_listens_show_day_idx" ON "podcast_listens" USING btree ("show_id","day");--> statement-breakpoint
CREATE INDEX "podcast_listens_episode_idx" ON "podcast_listens" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "podcast_shows_ws_idx" ON "podcast_shows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "short_rules_due_idx" ON "short_rules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "social_render_jobs_status_idx" ON "social_render_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "social_render_jobs_ws_idx" ON "social_render_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "social_render_jobs_post_idx" ON "social_render_jobs" USING btree ("post_id");
