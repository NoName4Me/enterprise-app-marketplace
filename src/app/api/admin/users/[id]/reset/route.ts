import { communityWrite } from "@/domain/community-route";
import { createRecovery } from "@/domain/account-security";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return communityWrite(request, (_actor, body) => createRecovery(request.headers, id, body.reason));
}
