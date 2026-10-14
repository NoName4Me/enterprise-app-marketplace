CREATE TABLE "app_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "component_app_key_unique" UNIQUE("app_id","key"),
	CONSTRAINT "component_app_id_unique" UNIQUE("app_id","id"),
	CONSTRAINT "component_key_check" CHECK ("app_components"."key" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "component_text_check" CHECK (length("app_components"."name") BETWEEN 1 AND 120 AND length("app_components"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "app_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "environment_app_key_unique" UNIQUE("app_id","key"),
	CONSTRAINT "environment_app_id_unique" UNIQUE("app_id","id"),
	CONSTRAINT "environment_key_check" CHECK ("app_environments"."key" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "environment_text_check" CHECK (length("app_environments"."name") BETWEEN 1 AND 120 AND length("app_environments"."notes") <= 1000),
	CONSTRAINT "environment_purpose_check" CHECK ("app_environments"."purpose" IN ('DEVELOPMENT','TEST','PRODUCTION'))
);
--> statement-breakpoint
CREATE TABLE "asset_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"asset_version_after" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_event_version_unique" UNIQUE("app_id","asset_version_after"),
	CONSTRAINT "asset_event_action_check" CHECK ("asset_events"."action" IN ('CREATED','UPDATED','ARCHIVED','RESTORED')),
	CONSTRAINT "asset_event_resource_check" CHECK ("asset_events"."resource_type" IN ('application','components','environments','bindings','references')),
	CONSTRAINT "asset_event_version_check" CHECK ("asset_events"."asset_version_after" > 1)
);
--> statement-breakpoint
CREATE TABLE "component_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "binding_app_pair_unique" UNIQUE("app_id","component_id","environment_id"),
	CONSTRAINT "binding_app_component_id_unique" UNIQUE("app_id","component_id","id")
);
--> statement-breakpoint
CREATE TABLE "external_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"binding_id" uuid,
	"provider" text DEFAULT 'GITHUB' NOT NULL,
	"resource_kind" text NOT NULL,
	"repository_full_name" text NOT NULL,
	"workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "reference_identity_unique" UNIQUE NULLS NOT DISTINCT("app_id","component_id","binding_id","resource_kind","repository_full_name","workflow_id"),
	CONSTRAINT "reference_provider_check" CHECK ("external_references"."provider" = 'GITHUB'),
	CONSTRAINT "reference_repository_check" CHECK ("external_references"."repository_full_name" ~ '^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9_.-]{1,100}$' AND split_part("external_references"."repository_full_name", '/', 2) NOT IN ('.','..')),
	CONSTRAINT "reference_kind_check" CHECK (("external_references"."resource_kind" = 'REPOSITORY' AND "external_references"."workflow_id" IS NULL) OR ("external_references"."resource_kind" = 'WORKFLOW' AND "external_references"."workflow_id" ~ '^[1-9][0-9]{0,19}$' AND "external_references"."workflow_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "asset_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "lifecycle_status" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "responsible_team_name" text;--> statement-breakpoint
ALTER TABLE "app_components" ADD CONSTRAINT "app_components_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_environments" ADD CONSTRAINT "app_environments_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_environments" ADD CONSTRAINT "component_environments_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_environments" ADD CONSTRAINT "binding_component_fk" FOREIGN KEY ("app_id","component_id") REFERENCES "public"."app_components"("app_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_environments" ADD CONSTRAINT "binding_environment_fk" FOREIGN KEY ("app_id","environment_id") REFERENCES "public"."app_environments"("app_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_references" ADD CONSTRAINT "external_references_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_references" ADD CONSTRAINT "reference_component_fk" FOREIGN KEY ("app_id","component_id") REFERENCES "public"."app_components"("app_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_references" ADD CONSTRAINT "reference_binding_fk" FOREIGN KEY ("app_id","component_id","binding_id") REFERENCES "public"."component_environments"("app_id","component_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "references_binding_idx" ON "external_references" USING btree ("app_id","binding_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_asset_version_positive" CHECK ("applications"."asset_version" > 0);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_lifecycle_check" CHECK ("applications"."lifecycle_status" IN ('UNKNOWN','PILOT','ACTIVE','DEPRECATED','RETIRED'));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_retired_unlisted" CHECK ("applications"."lifecycle_status" <> 'RETIRED' OR "applications"."listing_status" = 'UNLISTED');--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_team_length" CHECK (length("applications"."responsible_team_name") BETWEEN 1 AND 100);