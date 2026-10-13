CREATE TABLE "app_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"target_url" text DEFAULT '' NOT NULL,
	"icon_ref" text,
	"created_by" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_revisions_app_sequence_unique" UNIQUE("app_id","sequence"),
	CONSTRAINT "app_revision_sequence_positive" CHECK ("app_revisions"."sequence" > 0),
	CONSTRAINT "app_revision_status_check" CHECK ("app_revisions"."status" IN ('DRAFT','PENDING','APPROVED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"listing_status" text DEFAULT 'UNLISTED' NOT NULL,
	"published_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_listing_status_check" CHECK ("applications"."listing_status" IN ('UNLISTED','LISTED')),
	CONSTRAINT "application_public_pointer_check" CHECK ("applications"."listing_status" <> 'LISTED' OR "applications"."published_revision_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_event_revision_action_unique" UNIQUE("revision_id","action"),
	CONSTRAINT "review_event_action_check" CHECK ("review_events"."action" IN ('SUBMITTED','APPROVED','REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "app_revisions" ADD CONSTRAINT "app_revisions_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_revisions" ADD CONSTRAINT "app_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_revisions" ADD CONSTRAINT "app_revisions_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_revision_id_app_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."app_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_revisions_one_open_idx" ON "app_revisions" USING btree ("app_id") WHERE "app_revisions"."status" IN ('DRAFT','PENDING');--> statement-breakpoint
CREATE INDEX "app_revisions_pending_idx" ON "app_revisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_owner_idx" ON "applications" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "review_events_app_idx" ON "review_events" USING btree ("app_id");