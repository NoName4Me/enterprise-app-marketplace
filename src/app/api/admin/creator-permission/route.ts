import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { getActiveUser } from "@/lib/active-user";
import { mayReviewApp } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const caller = await getActiveUser(await headers());
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!mayReviewApp(caller)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { userId, canCreateApp } = payload as Record<string, unknown>;
  if (typeof userId !== "string" || !userId || typeof canCreateApp !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 422 });
  }

  const [target] = await db.update(user).set({ canCreateApp })
    .where(eq(user.id, userId)).returning({ id: user.id, canCreateApp: user.canCreateApp });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(target, { headers: { "Cache-Control": "no-store" } });
}
