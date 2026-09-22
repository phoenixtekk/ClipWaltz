ALTER TABLE "projects" ADD COLUMN "original_audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "music_volume" real;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "original_volume" real;