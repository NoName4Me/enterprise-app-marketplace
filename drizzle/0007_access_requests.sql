CREATE TABLE "app_access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL,
  "requester_user_id" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "provisioning_status" text DEFAULT 'NOT_STARTED' NOT NULL,
  "provisioned_by" text,
  "provisioned_at" timestamp with time zone,
  "provisioning_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "access_request_reason_check" CHECK (length("app_access_requests"."reason") BETWEEN 5 AND 500),
  CONSTRAINT "access_request_status_check" CHECK ("app_access_requests"."status" IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT "access_request_provision_status_check" CHECK ("app_access_requests"."provisioning_status" IN ('NOT_STARTED','PENDING','MANUAL_RECORDED')),
  CONSTRAINT "access_request_decision_check" CHECK ((
    ("app_access_requests"."status" = 'PENDING' AND "app_access_requests"."decided_by" IS NULL AND "app_access_requests"."decided_at" IS NULL AND "app_access_requests"."provisioning_status" = 'NOT_STARTED')
    OR ("app_access_requests"."status" = 'REJECTED' AND "app_access_requests"."decided_by" IS NOT NULL AND "app_access_requests"."decided_at" IS NOT NULL AND "app_access_requests"."provisioning_status" = 'NOT_STARTED')
    OR ("app_access_requests"."status" = 'APPROVED' AND "app_access_requests"."decided_by" IS NOT NULL AND "app_access_requests"."decided_at" IS NOT NULL AND "app_access_requests"."provisioning_status" IN ('PENDING','MANUAL_RECORDED'))
  )),
  CONSTRAINT "access_request_provision_check" CHECK ((
    ("app_access_requests"."provisioning_status" <> 'MANUAL_RECORDED' AND "app_access_requests"."provisioned_by" IS NULL AND "app_access_requests"."provisioned_at" IS NULL AND "app_access_requests"."provisioning_note" IS NULL)
    OR ("app_access_requests"."provisioning_status" = 'MANUAL_RECORDED' AND "app_access_requests"."provisioned_by" IS NOT NULL AND "app_access_requests"."provisioned_at" IS NOT NULL AND "app_access_requests"."provisioning_note" IS NOT NULL AND length("app_access_requests"."provisioning_note") BETWEEN 5 AND 500)
  )),
  CONSTRAINT "access_request_no_self_decision" CHECK ("app_access_requests"."decided_by" IS NULL OR "app_access_requests"."decided_by" <> "app_access_requests"."requester_user_id"),
  CONSTRAINT "access_request_no_self_provision" CHECK ("app_access_requests"."provisioned_by" IS NULL OR "app_access_requests"."provisioned_by" <> "app_access_requests"."requester_user_id")
);
--> statement-breakpoint
ALTER TABLE "app_access_requests" ADD CONSTRAINT "app_access_requests_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_access_requests" ADD CONSTRAINT "app_access_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_access_requests" ADD CONSTRAINT "app_access_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_access_requests" ADD CONSTRAINT "app_access_requests_provisioned_by_user_id_fk" FOREIGN KEY ("provisioned_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_active_idx" ON "app_access_requests" USING btree ("app_id","requester_user_id") WHERE "app_access_requests"."status" IN ('PENDING','APPROVED');
--> statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "app_access_requests" USING btree ("requester_user_id","created_at");
--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "app_access_requests" USING btree ("status","created_at");
