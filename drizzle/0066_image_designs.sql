CREATE TABLE "image_design_images" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"generation_job_id" text,
	"storage_key" text,
	"width" integer,
	"height" integer,
	"prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_design_images_source_check" CHECK ("image_design_images"."source" in ('ai', 'upload'))
);
--> statement-breakpoint
CREATE TABLE "image_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"kind" text DEFAULT 'image' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"format" text DEFAULT '1:1' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saved_media_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_designs_kind_check" CHECK ("image_designs"."kind" in ('image', 'carousel', 'meme'))
);
--> statement-breakpoint
ALTER TABLE "image_design_images" ADD CONSTRAINT "image_design_images_design_id_image_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."image_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_design_images" ADD CONSTRAINT "image_design_images_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_design_images" ADD CONSTRAINT "image_design_images_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_designs" ADD CONSTRAINT "image_designs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_designs" ADD CONSTRAINT "image_designs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_design_images_design_idx" ON "image_design_images" USING btree ("design_id");--> statement-breakpoint
CREATE INDEX "image_design_images_job_idx" ON "image_design_images" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "image_designs_ws_updated_idx" ON "image_designs" USING btree ("workspace_id","updated_at");
