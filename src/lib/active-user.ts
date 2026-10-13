import { AppError } from "@/domain/app-errors";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { mayUseMarketplace } from "@/lib/access";

/**
 * Always reload rights and ban status from PostgreSQL.
 * A cached session cannot preserve a revoked business permission.
 */
export async function getAuthenticatedUser(requestHeaders: Headers) {
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) return null;

  const [record] = await db.select({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    banned: user.banned,
    canCreateApp: user.canCreateApp,
    mustChangePassword: user.mustChangePassword,
  }).from(user).where(eq(user.id, current.user.id)).limit(1);

  return record && record.banned !== true ? record : null;
}

export async function getActiveUser(requestHeaders: Headers) {
  const current = await getAuthenticatedUser(requestHeaders);
  if (current?.mustChangePassword) throw new AppError(403, "password_change_required");
  return mayUseMarketplace(current ?? null) ? current : null;
}
