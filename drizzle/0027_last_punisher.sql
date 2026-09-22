CREATE TABLE "batch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_name" text NOT NULL,
	"project_id" text,
	"render_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"output_file" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "batch_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"inbox_path" text NOT NULL,
	"output_path" text NOT NULL,
	"done_path" text NOT NULL,
	"grouping" text DEFAULT 'subfolder' NOT NULL,
	"settings" jsonb,
	"schedule_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_jobs_ownerId_name_unique" UNIQUE("owner_id","name")
);
--> statement-breakpoint
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_batch_jobs_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD CONSTRAINT "batch_jobs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;