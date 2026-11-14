ALTER TABLE "social_auto_rules" ADD COLUMN "migration_hold" text;--> statement-breakpoint
ALTER TABLE "social_connections" ADD COLUMN "migration_hold" text;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD COLUMN "migration_hold" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "migration_hold" text;
