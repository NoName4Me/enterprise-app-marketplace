-- Additive only: preserve existing hosted release records and Mac mini market data.
ALTER TABLE "hosted_releases" ADD COLUMN "requirement_id" uuid;
--> statement-breakpoint
ALTER TABLE "hosted_releases" ADD CONSTRAINT "hosted_releases_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hosted_releases_requirement_idx" ON "hosted_releases" USING btree ("requirement_id","created_at");
