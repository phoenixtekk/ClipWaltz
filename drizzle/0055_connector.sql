CREATE TABLE "connector_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connector_pairings" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"name" text NOT NULL,
	"platform" text,
	"version" text,
	"approved_by" text,
	"connector_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_pairings_deviceCodeHash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "connector_pairings_userCode_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"platform" text,
	"version" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"last_seen_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_pairings" ADD CONSTRAINT "connector_pairings_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_jobs_queue" ON "connector_jobs" USING btree ("connector_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_token_hash" ON "connectors" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "connectors_user" ON "connectors" USING btree ("user_id");