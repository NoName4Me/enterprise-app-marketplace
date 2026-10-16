import { route } from "@/domain/route";
import { collectDevopsEvidence } from "@/domain/devops-evidence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => collectDevopsEvidence(actor, (await context.params).id, true));
}
