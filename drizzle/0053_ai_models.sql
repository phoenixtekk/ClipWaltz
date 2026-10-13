CREATE TABLE "ai_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"writing_provider" text DEFAULT 'builtin' NOT NULL,
	"source" text DEFAULT 'platform' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ai_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"key_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"model" text,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_prefs" ADD CONSTRAINT "ai_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_keys" ADD CONSTRAINT "user_ai_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_ai_keys_user_provider" ON "user_ai_keys" USING btree ("user_id","provider");