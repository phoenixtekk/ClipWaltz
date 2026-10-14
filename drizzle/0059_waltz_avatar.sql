CREATE TABLE "presenter_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"presenter_id" text,
	"kind" text DEFAULT 'likeness' NOT NULL,
	"subject_name" text NOT NULL,
	"statement" text NOT NULL,
	"code" text NOT NULL,
	"method" text DEFAULT 'code+face+voice-match' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "presenters" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'twin' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"consent_code" text,
	"footage_key" text,
	"consent_key" text,
	"thumb_key" text,
	"voice" text DEFAULT 'af_heart' NOT NULL,
	"meta" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "presenter_consents" ADD CONSTRAINT "presenter_consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presenter_consents" ADD CONSTRAINT "presenter_consents_presenter_id_presenters_id_fk" FOREIGN KEY ("presenter_id") REFERENCES "public"."presenters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presenters" ADD CONSTRAINT "presenters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presenter_consents_user_idx" ON "presenter_consents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "presenters_user_idx" ON "presenters" USING btree ("user_id","created_at");