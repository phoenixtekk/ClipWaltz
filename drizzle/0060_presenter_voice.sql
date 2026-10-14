ALTER TABLE "presenters" ADD COLUMN "voice_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "voice_consent_code" text;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "voice_consent_key" text;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "voice_ref_key" text;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "voice_error" text;