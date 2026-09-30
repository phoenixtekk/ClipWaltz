CREATE TABLE "deck_brief_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_brief_history" ADD CONSTRAINT "deck_brief_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deck_brief_history_user_text_idx" ON "deck_brief_history" USING btree ("user_id","text");--> statement-breakpoint
CREATE INDEX "deck_brief_history_user_idx" ON "deck_brief_history" USING btree ("user_id","used_at");