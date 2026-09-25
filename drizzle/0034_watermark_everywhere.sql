CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_versions" ADD COLUMN "clean_key" text;--> statement-breakpoint
-- Owner decision 2026-09-25: watermark every video on every plan by default (admin can turn paid plans off).
INSERT INTO "app_settings" ("key","value") VALUES ('watermark_paid_plans','true') ON CONFLICT ("key") DO NOTHING;
