import type { BetterAuthOptions } from "better-auth";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { rateLimitDb } from "@/db/client";

type Storage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;
let lastCleanup = 0;
function hash(key: string) { return createHash("sha256").update(key).digest("hex"); }
// One atomic PostgreSQL upsert, shared across workers and independent of auth rollback.
export const authRateStorage: Storage = {
  async consume(key, rule) {
    const now = Date.now(), threshold = now - rule.window * 1000;
    const result = await rateLimitDb.execute(sql`INSERT INTO auth_rate_limits (key,count,last_request) VALUES (${hash(key)},1,${now}) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN auth_rate_limits.last_request <= ${threshold} THEN 1 ELSE LEAST(auth_rate_limits.count + 1, ${rule.max + 1}) END, last_request = CASE WHEN auth_rate_limits.last_request <= ${threshold} THEN ${now} ELSE auth_rate_limits.last_request END RETURNING count,last_request`);
    const row = result.rows[0];
    if (now - lastCleanup > 60000) {
      lastCleanup = now;
      await rateLimitDb.execute(sql`DELETE FROM auth_rate_limits WHERE last_request < ${now - 86400000}`);
    }
    return { allowed: Number(row.count) <= rule.max, retryAfter: Number(row.count) <= rule.max ? null : Math.max(1, Math.ceil((Number(row.last_request) + rule.window * 1000 - now) / 1000)) };
  },
};
export const sensitiveActions: Record<string, string> = {
  "/admin/create-user": "ACCOUNT_CREATED", "/admin/ban-user": "ACCOUNT_BANNED",
  "/admin/unban-user": "ACCOUNT_RESTORED", "/admin/set-role": "ROLE_CHANGED",
  "/admin/remove-user": "ACCOUNT_REMOVED", "/admin/update-user": "ACCOUNT_UPDATED",
  "/admin/revoke-user-sessions": "SESSIONS_REVOKED", "/admin/revoke-user-session": "SESSION_REVOKED",
  "/sign-out": "SIGNED_OUT", "/revoke-session": "SESSION_REVOKED", "/revoke-other-sessions": "SESSIONS_REVOKED", "/revoke-sessions": "SESSIONS_REVOKED",
  "/change-password": "PASSWORD_CHANGED", "/update-user": "PROFILE_UPDATED",
};
