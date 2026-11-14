CREATE TABLE "product_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text,
	"price" text,
	"currency" text,
	"brand" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'text' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"reviewer_user_id" text,
	"via_token" boolean DEFAULT false NOT NULL,
	"reviewer_name" text,
	"decision" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_post_reviews_decision_check" CHECK ("social_post_reviews"."decision" in ('submitted', 'approved', 'changes_requested'))
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "plan_angle" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "social_require_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_reviews" ADD CONSTRAINT "social_post_reviews_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_reviews" ADD CONSTRAINT "social_post_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_reviews" ADD CONSTRAINT "social_post_reviews_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_sources_ws_idx" ON "product_sources" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "social_post_reviews_post_idx" ON "social_post_reviews" USING btree ("post_id","created_at");