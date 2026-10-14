ALTER TABLE "connector_jobs" ADD COLUMN "inputs" jsonb;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD COLUMN "output_key" text;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD COLUMN "progress" integer;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "gpu" jsonb;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "comfy" jsonb;