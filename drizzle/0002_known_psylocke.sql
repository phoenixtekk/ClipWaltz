ALTER TABLE "projects" ADD COLUMN "title_text" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "style_filter" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "transition" text DEFAULT 'cut' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "motion" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "fades" boolean DEFAULT true NOT NULL;