ALTER TABLE "generation_jobs" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "source" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "photo_at" real;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "build_charge_id" text;