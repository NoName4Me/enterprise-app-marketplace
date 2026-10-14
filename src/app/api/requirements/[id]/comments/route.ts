import { assetWrite } from "@/domain/asset-route";
import { commentRequirement } from "@/domain/requirement-service";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type C = { params: Promise<{ id: string }> };
export function POST(req: Request, c: C) { return assetWrite(req, async (a,b) => commentRequirement(a,(await c.params).id,b), 201); }
