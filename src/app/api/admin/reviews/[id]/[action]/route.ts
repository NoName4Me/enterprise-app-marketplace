import { route } from "@/domain/route";
import { AppError, readObjectJson } from "@/domain/app-errors";
import { reviewRevision } from "@/domain/app-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; action: string }> };

export function POST(request: Request, context: Context) {
  return route(request, async (actor) => {
    const { id, action } = await context.params;
    if (action === "approve") return reviewRevision(actor, id, "APPROVED");
    if (action !== "reject") throw new AppError(404, "not_found");
    const body = await readObjectJson(request);
    if (Object.keys(body).some(key => key !== "reason")) {
      throw new AppError(422, "unknown_field");
    }
    return reviewRevision(actor, id, "REJECTED", body.reason);
  });
}
