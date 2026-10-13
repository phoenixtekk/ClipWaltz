-- Talking photo (Phase C2): EchoMimic v3-Flash in the clipwaltz-talking service on AISERVER. Registry rows give admins
-- an on/off switch (AI routing page); the app checks both rows are enabled before taking a job. Idempotent.
INSERT INTO "model_registry" ("id","name","family","role","enabled","vram_profile_mb","capabilities","description") VALUES
 ('echomimic-v3','echomimic-v3','EchoMimic v3-Flash (Wan2.1-Fun 1.3B)','primary',true,7800,'{"talkingPhoto":true,"maxDurationSec":30}','Photo + speech to a talking video, chunked on one 10 GB GPU. Apache-2.0.')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workflow_registry" ("id","workflow_id","version","task","model_name","input_types","aspect_ratios","duration_min","duration_max","required_vram_mb","expected_output","workflow_path","enabled") VALUES
 ('echomimic-talking-v1','echomimic-talking','v1','talking_photo','echomimic-v3','["image","audio","text"]','["9:16","16:9","1:1"]',1,30,7800,'mp4','aiserver/talking/service.py',true)
ON CONFLICT ("id") DO NOTHING;
