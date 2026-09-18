ALTER TABLE "assets" ADD COLUMN "source_format" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "conversion_state" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "converted_key" text;