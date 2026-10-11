CREATE TABLE "shared_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"hits" timestamp with time zone[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "shared_rate_limits_expiry_idx" ON "shared_rate_limits" USING btree ("expires_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."shared_rate_limits" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."shared_rate_limits" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."shared_rate_limits" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'machinarc_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."shared_rate_limits" TO machinarc_server;
    CREATE POLICY "shared_rate_limits_server" ON "public"."shared_rate_limits"
      FOR ALL TO machinarc_server USING (true) WITH CHECK (true);
  END IF;
END
$$;
