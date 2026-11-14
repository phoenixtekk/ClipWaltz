CREATE TABLE "api_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"idem_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"platform" text NOT NULL,
	"store_url" text NOT NULL,
	"label" text,
	"currency" text,
	"credentials" text,
	"webhook_secret" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_count" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_connections_platform_check" CHECK ("commerce_connections"."platform" in ('shopify', 'woocommerce', 'wix'))
);
--> statement-breakpoint
CREATE TABLE "competitor_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"title" text,
	"text" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"summary" text,
	"summary_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_sources_kind_check" CHECK ("competitor_sources"."kind" in ('rss', 'youtube', 'bluesky', 'mastodon'))
);
--> statement-breakpoint
ALTER TABLE "product_sources" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "product_sources" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "product_sources" ADD COLUMN "available" boolean;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_connections" ADD CONSTRAINT "commerce_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_connections" ADD CONSTRAINT "commerce_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_source_id_competitor_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."competitor_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_sources" ADD CONSTRAINT "competitor_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_sources" ADD CONSTRAINT "competitor_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_key_idx" ON "api_idempotency" USING btree ("key_id","idem_key");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_ws_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_requests_key_at_idx" ON "api_requests" USING btree ("key_id","at");--> statement-breakpoint
CREATE INDEX "api_requests_at_idx" ON "api_requests" USING btree ("at");--> statement-breakpoint
CREATE INDEX "commerce_connections_ws_idx" ON "commerce_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_posts_source_ext_idx" ON "competitor_posts" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "competitor_posts_ws_idx" ON "competitor_posts" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE INDEX "competitor_sources_ws_idx" ON "competitor_sources" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_connection_id_commerce_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."commerce_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_sources_conn_ext_idx" ON "product_sources" USING btree ("connection_id","external_id");