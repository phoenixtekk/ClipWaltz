CREATE TABLE "generation_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"is_recent" boolean DEFAULT false NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "pair_media_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_template_id" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "selected_version_id" text;--> statement-breakpoint
ALTER TABLE "generation_presets" ADD CONSTRAINT "generation_presets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- CW-MVP-150 template categories (idempotent; admins may edit rows later). metadata_json pre-fills the Generate tab.
INSERT INTO "templates" ("id","name","category","workflow_profile","description","metadata_json","enabled") VALUES
 ('tpl-product-promo','Product Promo','product','standard','A clean, polished spot that shows off a product.','{"mode":"image","prompt":"the product slowly rotating on a clean studio set, soft light, crisp detail","style":"commercial","camera":"orbit","motion":"subtle","aspect":"1:1","duration":5,"quality":"high"}',true),
 ('tpl-social-reel','Social Reel','social','standard','Vertical, punchy and made for Reels/TikTok/Shorts.','{"mode":"image","prompt":"vibrant, energetic moment with bold colour","style":"social","camera":"push","motion":"dynamic","aspect":"9:16","duration":5,"quality":"standard"}',true),
 ('tpl-story','Story','story','standard','A gentle, narrative moment that tells a small story.','{"mode":"image","prompt":"a quiet moment unfolding, natural light, emotional","style":"documentary","camera":"push","motion":"subtle","aspect":"16:9","duration":8,"quality":"standard"}',true),
 ('tpl-event-recap','Event Recap','event','standard','Lively highlights from a party, trip or celebration.','{"mode":"image","prompt":"friends celebrating, lively atmosphere, candid energy","style":"social","camera":"handheld","motion":"dynamic","aspect":"16:9","duration":5,"quality":"standard"}',true),
 ('tpl-travel','Travel','travel','standard','Sweeping scenery and a sense of place.','{"mode":"image","prompt":"sweeping view of the landscape, golden hour, sense of adventure","style":"cinematic","camera":"drone","motion":"balanced","aspect":"16:9","duration":8,"quality":"standard"}',true),
 ('tpl-cinematic-intro','Cinematic Intro','cinematic','standard','A dramatic, film-style opening shot.','{"mode":"text","prompt":"a dramatic opening shot, moody light, volumetric fog, epic scale","style":"cinematic","camera":"pull","motion":"balanced","aspect":"16:9","duration":5,"quality":"high"}',true)
ON CONFLICT ("id") DO NOTHING;
