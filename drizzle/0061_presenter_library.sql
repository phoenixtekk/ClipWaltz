ALTER TABLE "presenters" ADD COLUMN "library" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "release_ref" text;--> statement-breakpoint
ALTER TABLE "presenters" ADD COLUMN "portrait_keys" jsonb;