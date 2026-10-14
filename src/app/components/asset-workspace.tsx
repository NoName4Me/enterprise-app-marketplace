import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { getAssets, getAssetEvents } from "@/domain/asset-service";
import { lifecyclePreflight } from "@/domain/lifecycle-service";
import type { Actor } from "@/domain/actor";
import { AssetPanel } from "./asset-panel";
export async function AssetWorkspace({ actor, appId, canWrite, admin = false }: { actor: Actor; appId: string; canWrite: boolean; admin?: boolean }) {
  const assets = await getAssets(actor, appId, admin);
  const preflight = await lifecyclePreflight(actor, appId, admin);
  const events = await getAssetEvents(actor, appId, admin);
  const candidates = admin ? await db.select({ id: user.id, name: user.name }).from(user).where(and(eq(user.banned, false), eq(user.mustChangePassword, false), eq(user.canCreateApp, true))).orderBy(user.name).limit(100) : [];
  return <AssetPanel appId={appId} initial={JSON.parse(JSON.stringify(assets))} initialPreflight={preflight} initialEvents={JSON.parse(JSON.stringify(events))} canWrite={canWrite} admin={admin} candidates={candidates} />;
}
