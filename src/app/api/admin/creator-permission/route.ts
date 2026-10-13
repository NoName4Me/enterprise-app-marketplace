import { eq, inArray } from "drizzle-orm";
import { db, inDatabaseTransaction } from "@/db/client";
import { securityEvents, user } from "@/db/schema";
import { authorizeActor } from "@/domain/actor";
import { AppError } from "@/domain/app-errors";
import { communityWrite } from "@/domain/community-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) {
  return communityWrite(request, async (actor, payload) => {
    await authorizeActor(actor, "review");
    const { userId, canCreateApp } = payload;
    if (typeof userId !== "string" || !userId || typeof canCreateApp !== "boolean" || Object.keys(payload).some(key => !["userId", "canCreateApp"].includes(key))) throw new AppError(422, "invalid_body");
    return inDatabaseTransaction(async () => {
      await db.select({ id: user.id }).from(user).where(inArray(user.id, [actor!.id, userId])).orderBy(user.id).for("update");
      await authorizeActor(actor, "review");
      const [before] = await db.select({ canCreateApp: user.canCreateApp }).from(user).where(eq(user.id, userId)).for("update");
      if (!before) throw new AppError(404, "not_found");
      const [target] = await db.update(user).set({ canCreateApp }).where(eq(user.id, userId)).returning({ id: user.id, canCreateApp: user.canCreateApp });
      await db.insert(securityEvents).values({ actorUserId: actor!.id, targetUserId: userId, action: "CREATE_PERMISSION_CHANGED", before, after: { canCreateApp } });
      return target;
    });
  });
}
