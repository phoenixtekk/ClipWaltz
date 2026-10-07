CREATE TABLE "cloud_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"default_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cloud_targets" jsonb;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "cloud_targets" jsonb;--> statement-breakpoint
ALTER TABLE "cloud_prefs" ADD CONSTRAINT "cloud_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;