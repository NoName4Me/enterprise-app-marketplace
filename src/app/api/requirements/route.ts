import { route } from "@/domain/route";
import { createRequirement, listRequirements } from "@/domain/requirement-service";
import { assetWrite } from "@/domain/asset-route";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export function GET(request: Request) { return route(request, listRequirements); }
export function POST(request: Request) { return assetWrite(request, createRequirement, 201); }
