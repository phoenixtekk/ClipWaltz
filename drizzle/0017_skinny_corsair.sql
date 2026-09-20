CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"image_url" text,
	"cta_label" text,
	"cta_url" text,
	"placement" text DEFAULT 'dashboard_card' NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"accent" text DEFAULT 'violet' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"aspect" text DEFAULT '9:16' NOT NULL,
	"length_sec" integer DEFAULT 30 NOT NULL,
	"max_footage" boolean DEFAULT false NOT NULL,
	"style_filter" text DEFAULT 'none' NOT NULL,
	"light_fx" text DEFAULT 'none' NOT NULL,
	"transition" text DEFAULT 'cut' NOT NULL,
	"motion" boolean DEFAULT true NOT NULL,
	"fades" boolean DEFAULT true NOT NULL,
	"fade_out" boolean DEFAULT true NOT NULL,
	"smart_cut" boolean DEFAULT true NOT NULL,
	"beat_sync" boolean DEFAULT true NOT NULL,
	"waltz_to_music" boolean DEFAULT false NOT NULL,
	"loop_to_fill" boolean DEFAULT false NOT NULL,
	"overlays" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "max_footage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;