CREATE TABLE "hosted_releases" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "app_id" uuid NOT NULL,
 "environment" text NOT NULL,
 "requested_by" text NOT NULL,
 "status" text DEFAULT 'REQUESTING' NOT NULL,
 "workflow_id" text NOT NULL,
 "source_sha" text, "build_run_id" text, "image_digest" text,
 "gitops_pr_number" integer, "note" text DEFAULT '' NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "hosted_releases_workflow_id_unique" UNIQUE("workflow_id"),
 CONSTRAINT "hosted_releases_environment_check" CHECK ("hosted_releases"."environment" IN ('TEST','PRODUCTION')),
 CONSTRAINT "hosted_releases_status_check" CHECK ("hosted_releases"."status" IN ('REQUESTING','BUILDING','WAITING_PR','DEPLOYING','READY','FAILED','NEEDS_RECONCILIATION'))
);
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD CONSTRAINT "hosted_releases_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD CONSTRAINT "hosted_releases_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hosted_releases_app_created_idx" ON "hosted_releases" USING btree ("app_id","created_at");
