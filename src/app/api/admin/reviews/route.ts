import { route } from "@/domain/route";
import { listPendingReviews } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return route(request, listPendingReviews);
}
