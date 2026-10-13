import { route } from "@/domain/route";
import { listPublished } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return route(request, (actor) =>
    listPublished(actor, params.get("q") ?? "", { category: params.get("category") || undefined,
      sort: params.get("sort") || undefined, saved: params.get("saved") === "1", page: Number(params.get("page") ?? "1") }));
}
