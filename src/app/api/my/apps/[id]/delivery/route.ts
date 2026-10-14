import { route } from "@/domain/route";
import { getArgoOverview } from "@/domain/argocd-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return route(request, async actor => getArgoOverview(actor, (await context.params).id, false));
}
