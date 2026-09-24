CREATE TABLE "routing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"quality" text NOT NULL,
	"workflow_registry_id" text NOT NULL,
	"steps" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_registry" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_workflow_registry_id_workflow_registry_id_fk" FOREIGN KEY ("workflow_registry_id") REFERENCES "public"."workflow_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed the AI registry + default routing (CW-MVP-070/071, ADR-0009). Idempotent; never overwrites admin edits.
INSERT INTO "model_registry" ("id","name","family","role","enabled","vram_profile_mb","capabilities","description") VALUES
 ('wan','wan','Wan 2.2 TI2V-5B (fp8)','primary',true,6000,'{"imageToVideo":true,"textToVideo":true,"maxDurationSec":12,"aspectRatios":["16:9","9:16","1:1"]}','Text/image to video. Apache-2.0.'),
 ('real-esrgan','real-esrgan','Real-ESRGAN x2plus','enhance',true,2000,'{"upscale":2}','2x super-resolution. BSD-3-Clause.'),
 ('rife','rife','RIFE 4.7','enhance',true,2000,'{"interpolate":2}','2x frame interpolation. MIT.'),
 ('seedvr2','seedvr2','SeedVR2-3B (fp8)','premium',true,8800,'{"restore":true,"maxShortSide":1080}','Diffusion video restoration. Apache-2.0 (ADR-0007).')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workflow_registry" ("id","workflow_id","version","task","model_name","input_types","aspect_ratios","duration_min","duration_max","required_vram_mb","expected_output","workflow_path","enabled") VALUES
 ('wan-text-to-video-v1','wan-text-to-video','v1','text_to_video','wan','["text"]','["16:9","9:16","1:1"]',1,12,9000,'mp4','wan/workflow.t2v.api.json',true),
 ('wan-image-to-video-v1','wan-image-to-video','v1','image_to_video','wan','["image","text"]','["16:9","9:16","1:1"]',1,12,9000,'mp4','wan/workflow.api.json',true),
 ('esrgan-upscale-v1','esrgan-upscale','v1','upscale','real-esrgan','["video"]',NULL,NULL,NULL,4000,'mp4','wan/enhance.api.json',true),
 ('rife-interpolate-v1','rife-interpolate','v1','interpolate','rife','["video"]',NULL,NULL,NULL,4000,'mp4','wan/rife.api.json',true),
 ('seedvr2-restore-v1','seedvr2-restore','v1','restore','seedvr2','["video"]',NULL,NULL,NULL,8800,'mp4','seedvr2/restore.api.json',true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "routing_rules" ("id","task","quality","workflow_registry_id","steps","priority") VALUES
 ('t2v-preview','text_to_video','preview','wan-text-to-video-v1',10,0),
 ('t2v-standard','text_to_video','standard','wan-text-to-video-v1',20,0),
 ('t2v-high','text_to_video','high','wan-text-to-video-v1',30,0),
 ('i2v-preview','image_to_video','preview','wan-image-to-video-v1',10,0),
 ('i2v-standard','image_to_video','standard','wan-image-to-video-v1',20,0),
 ('i2v-high','image_to_video','high','wan-image-to-video-v1',30,0)
ON CONFLICT ("id") DO NOTHING;
