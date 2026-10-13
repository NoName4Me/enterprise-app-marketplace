import { and, eq, inArray, like } from "drizzle-orm";
import { db, inDatabaseTransaction } from "@/db/client";
import { securityEvents, user, verification } from "@/db/schema";
import { authRateStorage } from "@/lib/security-policy";
import { auth, issueRecoveryLink } from "@/lib/auth";
import { getActiveUser } from "@/lib/active-user";
import { authorizeActor } from "./actor";
import { AppError } from "./app-errors";

export async function createRecovery(headers: Headers, targetId: string, reason: unknown) {
  const actor = await getActiveUser(headers);
  await authorizeActor(actor, "review");
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) throw new AppError(422, "invalid_text");
  const limit = await authRateStorage.consume!("issue-recovery:" + actor!.id, { window: 300, max: 10 });
  if (!limit.allowed) throw new AppError(429, "too_many_requests");
  if (targetId === actor!.id) throw new AppError(422, "use_own_password_change");
  return inDatabaseTransaction(async () => {
    const ids = [actor!.id, targetId].sort();
    await db.select({ id: user.id }).from(user).where(inArray(user.id, ids)).orderBy(user.id).for("update");
    await authorizeActor(actor, "review");
    const [target] = await db.select().from(user).where(eq(user.id, targetId)).limit(1);
    if (!target || target.banned) throw new AppError(404, "not_found");
    await db.delete(verification).where(and(eq(verification.value, targetId), like(verification.identifier, "reset-password:%")));
    await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, targetId));
    await auth.api.revokeUserSessions({ headers, body: { userId: targetId } });
    const url = await issueRecoveryLink(targetId, target.email, headers);
    await db.insert(securityEvents).values({ actorUserId: actor!.id, targetUserId: targetId, action: "PASSWORD_RESET_ISSUED", before: { mustChangePassword: target.mustChangePassword }, after: { mustChangePassword: true }, reason: reason.trim() });
    return { url, expiresInMinutes: 15 };
  });
}
