CREATE TABLE "render_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_exports" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "deck_exports" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "conversion_worker" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "conversion_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "heartbeat_at" timestamp with time zone;