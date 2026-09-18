CREATE TABLE "render_likes" (
	"id" text PRIMARY KEY NOT NULL,
	"render_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "render_likes" ADD CONSTRAINT "render_likes_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_likes" ADD CONSTRAINT "render_likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;