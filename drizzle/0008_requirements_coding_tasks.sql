CREATE TABLE "requirements" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"app_id" uuid,"created_by" text NOT NULL,"type" text NOT NULL,"title" text NOT NULL,"description" text NOT NULL,"status" text DEFAULT 'OPEN' NOT NULL,"github_issue_url" text,"github_pr_url" text,"resolution" text,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "requirements_app_idx" ON "requirements" ("app_id", "created_at");
--> statement-breakpoint
CREATE INDEX "requirements_author_idx" ON "requirements" ("created_by", "created_at");
--> statement-breakpoint
CREATE TABLE "requirement_comments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"requirement_id" uuid NOT NULL,"user_id" text NOT NULL,"body" text NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "requirement_comments_idx" ON "requirement_comments" ("requirement_id", "created_at");
--> statement-breakpoint
CREATE TABLE "coding_tasks" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"requirement_id" uuid NOT NULL,"created_by" text NOT NULL,"repository" text NOT NULL,"external_task_id" text,"state" text DEFAULT 'REQUESTING' NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "coding_tasks" ADD CONSTRAINT "coding_tasks_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "coding_tasks" ADD CONSTRAINT "coding_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "coding_tasks" ADD CONSTRAINT "coding_tasks_requirement_unique" UNIQUE ("requirement_id");
--> statement-breakpoint
