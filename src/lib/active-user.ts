import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { mayUseMarketplace } from "@/lib/access";

/**
 * Always reload rights and ban status from PostgreSQL.
 * A cached session cannot preserve a revoked business permission.
 */
export async function getActiveUser(requestHeaders: Headers) {
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) return null;

  const [record] = await db.select({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    banned: user.banned,
    canCreateApp: user.canCreateApp,
  }).from(user).where(eq(user.id, current.user.id)).limit(1);

  return mayUseMarketplace(record ?? null) ? record : null;
}
