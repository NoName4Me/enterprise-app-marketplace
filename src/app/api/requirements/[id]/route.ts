import { route } from "@/domain/route";
import { assetWrite } from "@/domain/asset-route";
import { getRequirement, updateRequirement } from "@/domain/requirement-service";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type C = { params: Promise<{ id: string }> };
export function GET(req: Request, c: C) { return route(req, async a => getRequirement(a, (await c.params).id)); }
export function PATCH(req: Request, c: C) { return assetWrite(req, async (a,b) => updateRequirement(a,(await c.params).id,b)); }
