-- Preserve hosted release ledger; add human-facing version metadata.
ALTER TABLE "hosted_releases" ADD COLUMN "deploy_driver" text DEFAULT 'GITOPS' NOT NULL;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "source_ref" text;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "version_label" text;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD COLUMN "release_notes" text;
--> statement-breakpoint
-- GitHub Issues are not a requirement system; remove the obsolete field.
ALTER TABLE "requirements" DROP COLUMN "github_issue_url";
