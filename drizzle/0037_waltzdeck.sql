CREATE TABLE "deck_scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"role" text DEFAULT 'content' NOT NULL,
	"asset_id" text,
	"in_sec" real,
	"out_sec" real,
	"duration_sec" real DEFAULT 3 NOT NULL,
	"text_mode" text DEFAULT 'auto' NOT NULL,
	"text" jsonb,
	"layout" text DEFAULT 'headline-bottom' NOT NULL,
	"motion" text DEFAULT 'auto' NOT NULL,
	"transition" text DEFAULT 'cut' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"prompt" text,
	"why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "ai_description" jsonb;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'autowaltz' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deck" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brand_kit_id" text;--> statement-breakpoint
ALTER TABLE "deck_scenes" ADD CONSTRAINT "deck_scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_scenes" ADD CONSTRAINT "deck_scenes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;