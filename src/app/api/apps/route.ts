import { route } from "@/domain/route";
import { listPublished } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return route(request, (actor) =>
    listPublished(actor, new URL(request.url).searchParams.get("q") ?? ""));
}
