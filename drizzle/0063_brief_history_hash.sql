DROP INDEX IF EXISTS "deck_brief_history_user_text_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deck_brief_history_user_text_idx" ON "deck_brief_history" USING btree ("user_id",md5("text"));
