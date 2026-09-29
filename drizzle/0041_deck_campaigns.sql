CREATE TABLE "deck_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"config" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"parent_id" text,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_events" (
	"id" text PRIMARY KEY NOT NULL,
	"render_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"type" text NOT NULL,
	"visitor" text NOT NULL,
	"net" text DEFAULT '' NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "variant" jsonb;--> statement-breakpoint
ALTER TABLE "deck_campaigns" ADD CONSTRAINT "deck_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_events" ADD CONSTRAINT "variant_events_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variant_events_dedupe_idx" ON "variant_events" USING btree ("render_id","type","visitor","day");--> statement-breakpoint
CREATE INDEX "variant_events_campaign_idx" ON "variant_events" USING btree ("campaign_id","type");