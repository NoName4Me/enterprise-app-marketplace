import { route } from "@/domain/route";
import { readObjectJson } from "@/domain/app-errors";
import { createApplication, listOwnedApplications } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return route(request, listOwnedApplications);
}
export function POST(request: Request) {
  return route(request, async (actor) =>
    createApplication(actor, await readObjectJson(request)), 201);
}
