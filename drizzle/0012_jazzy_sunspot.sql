CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"original_name" text,
	"storage_key" text NOT NULL,
	"converted_key" text,
	"source_format" text,
	"conversion_state" text DEFAULT 'ready' NOT NULL,
	"size_bytes" integer,
	"duration_sec" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "media_id" text;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "media" ("id","owner_id","kind","original_name","storage_key","converted_key","source_format","conversion_state","duration_sec","created_at")
SELECT a."id", p."owner_id", a."kind", a."original_name", a."storage_key", a."converted_key", a."source_format", a."conversion_state", a."duration_sec", a."created_at"
FROM "assets" a JOIN "projects" p ON p."id" = a."project_id";
--> statement-breakpoint
UPDATE "assets" SET "media_id" = "id" WHERE "media_id" IS NULL;
