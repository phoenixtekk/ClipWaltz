ALTER TABLE "ai_prefs" ADD COLUMN "platform_day" text;--> statement-breakpoint
ALTER TABLE "ai_prefs" ADD COLUMN "platform_jobs" integer DEFAULT 0 NOT NULL;