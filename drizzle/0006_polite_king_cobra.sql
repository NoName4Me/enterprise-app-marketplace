ALTER TABLE "asset_events" DROP CONSTRAINT "asset_event_action_check";--> statement-breakpoint
ALTER TABLE "asset_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_event_reason_check" CHECK (length("asset_events"."reason") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_event_action_check" CHECK ("asset_events"."action" IN ('CREATED','UPDATED','ARCHIVED','RESTORED','TRANSITIONED','OWNER_TRANSFERRED'));