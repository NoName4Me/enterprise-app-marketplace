import { route } from "@/domain/route";
import { getAssetEvents } from "@/domain/asset-service";
import { AppError } from "@/domain/app-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => {
    const value = new URL(request.url).searchParams.get("beforeVersion");
    if (value !== null && !/^[1-9][0-9]{0,9}$/.test(value)) throw new AppError(422, "invalid_cursor");
    return getAssetEvents(actor, (await context.params).id, false, value === null ? undefined : Number(value));
  });
}
