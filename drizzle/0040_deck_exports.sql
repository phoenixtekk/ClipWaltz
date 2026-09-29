CREATE TABLE "deck_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"watermark" boolean DEFAULT true NOT NULL,
	"output_key" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deck_exports" ADD CONSTRAINT "deck_exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;