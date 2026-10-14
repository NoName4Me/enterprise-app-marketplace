import { route } from "@/domain/route";
import { requestLabRolloutAction } from "@/domain/p4-rollout-action";
import { AppError, readObjectJson } from "@/domain/app-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return route(request, async actor => {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AppError(403, "forbidden");
    const body = await readObjectJson(request);
    return requestLabRolloutAction(actor, (await context.params).id, body.action);
  });
}
