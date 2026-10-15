ALTER TABLE "applications" ADD COLUMN "source_kind" text DEFAULT 'EXTERNAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "source_repository" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_source_kind_check" CHECK ("applications"."source_kind" IN ('EXTERNAL','HOSTED'));
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "application_hosted_repo_check" CHECK ("applications"."source_kind" <> 'HOSTED' OR "applications"."source_repository" IS NOT NULL);
