import { route } from "@/domain/route";
import { openNewDraft } from "@/domain/app-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return route(request, async (actor) =>
    openNewDraft(actor, (await context.params).id), 201);
}
