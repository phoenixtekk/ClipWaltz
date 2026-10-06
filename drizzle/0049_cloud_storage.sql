CREATE TABLE "cloud_saves" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"render_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"remote_path" text,
	"bytes" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "account_label" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "auto_save" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "folder_layout" text DEFAULT 'category' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "cloud_saves" ADD CONSTRAINT "cloud_saves_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_saves" ADD CONSTRAINT "cloud_saves_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_saves_render_provider" ON "cloud_saves" USING btree ("render_id","provider");--> statement-breakpoint
CREATE INDEX "cloud_saves_user" ON "cloud_saves" USING btree ("user_id");