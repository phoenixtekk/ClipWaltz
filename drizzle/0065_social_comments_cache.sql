ALTER TABLE "social_post_targets" ADD COLUMN "comments" jsonb;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD COLUMN "comments_at" timestamp with time zone;
