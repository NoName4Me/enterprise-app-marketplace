import { route } from "@/domain/route";
import { readObjectJson } from "@/domain/app-errors";
import { deleteNewDraft, editDraft, getOwnedApplication } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return route(request, async (actor) =>
    getOwnedApplication(actor, (await context.params).id));
}
export function PATCH(request: Request, context: Context) {
  return route(request, async (actor) =>
    editDraft(actor, (await context.params).id, await readObjectJson(request)));
}

export function DELETE(request: Request, context: Context) {
  return route(request, async actor =>
    deleteNewDraft(actor, (await context.params).id));
}
