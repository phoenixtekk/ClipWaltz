CREATE TABLE "music_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_favorites_userId_trackId_unique" UNIQUE("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "render_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"render_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"provider" text NOT NULL,
	"provider_track_id" text,
	"track_title" text,
	"artist" text,
	"license_type" text,
	"license_ref" text,
	"clearance_status" text DEFAULT 'n/a' NOT NULL,
	"clearance_ref" text,
	"licensed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "provider" text DEFAULT 'pixabay' NOT NULL;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "provider_track_id" text;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "premium" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "fade_out" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "music_favorites" ADD CONSTRAINT "music_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_favorites" ADD CONSTRAINT "music_favorites_track_id_music_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."music_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_licenses" ADD CONSTRAINT "render_licenses_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_licenses" ADD CONSTRAINT "render_licenses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;