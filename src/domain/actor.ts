import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { AppError } from "./app-errors";
import { mayCreateApp, mayReviewApp } from "@/lib/access";

export type Actor = { id: string };

export async function authorizeActor(
  actor: Actor | null,
  permission: "active" | "create" | "review",
  database: Pick<typeof db, "select"> = db,
) {
  if (!actor) throw new AppError(401, "unauthorized");
  const [record] = await database.select({
    id: user.id, role: user.role, banned: user.banned,
    canCreateApp: user.canCreateApp, mustChangePassword: user.mustChangePassword,
  }).from(user).where(and(eq(user.id, actor.id), eq(user.banned, false))).limit(1);
  if (record?.mustChangePassword) throw new AppError(403, "password_change_required");
  if (!record) throw new AppError(401, "unauthorized");
  if (permission === "create" && !mayCreateApp(record)) throw new AppError(403, "forbidden");
  if (permission === "review" && !mayReviewApp(record)) throw new AppError(403, "forbidden");
  return record;
}
