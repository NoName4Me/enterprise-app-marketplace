import { route } from "@/domain/route";
import { getGithubOverview } from "@/domain/github-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return route(request, async actor => getGithubOverview(actor, (await context.params).id, false));
}
