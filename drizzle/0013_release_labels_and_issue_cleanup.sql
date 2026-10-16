-- Dev-only prototype cleanup: old GitOps release history is disposable.
-- Keep applications and requirements, reset only experimental release pointers.
DELETE FROM "hosted_releases";
--> statement-breakpoint
UPDATE "app_hosted_ports" SET "state" = 'RESERVED', "image_digest" = NULL,
  "verified_at" = NULL, "updated_at" = now();
--> statement-breakpoint
ALTER TABLE "hosted_releases" DROP CONSTRAINT "hosted_releases_status_check";
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD CONSTRAINT "hosted_releases_status_check"
  CHECK ("status" IN ('REQUESTING','BUILDING','DEPLOYING','READY','FAILED','NEEDS_RECONCILIATION'));
--> statement-breakpoint
ALTER TABLE "hosted_releases" DROP COLUMN "gitops_pr_number";
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "source_ref" text;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "version_label" text;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "release_notes" text;
--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "github_issue_url";
