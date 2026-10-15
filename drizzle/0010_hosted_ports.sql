CREATE TABLE "app_hosted_ports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL,
  "environment" text NOT NULL,
  "node_port" integer NOT NULL,
  "state" text DEFAULT 'RESERVED' NOT NULL,
  "image_digest" text,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "hosted_ports_app_environment_unique" UNIQUE ("app_id","environment"),
  CONSTRAINT "hosted_ports_node_port_unique" UNIQUE ("node_port")
);
--> statement-breakpoint
ALTER TABLE "app_hosted_ports" ADD CONSTRAINT "app_hosted_ports_app_id_applications_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;
