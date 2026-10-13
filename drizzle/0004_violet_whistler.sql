CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"action" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Existing accounts retain access; all newly provisioned accounts must change their initial password.
ALTER TABLE "user" ALTER COLUMN "must_change_password" SET DEFAULT true;--> statement-breakpoint
CREATE INDEX "auth_rate_limits_time_idx" ON "auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE INDEX "security_events_time_idx" ON "security_events" USING btree ("occurred_at");