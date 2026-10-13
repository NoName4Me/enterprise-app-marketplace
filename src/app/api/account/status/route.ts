import { getAuthenticatedUser } from "@/lib/active-user";
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request.headers);
  return Response.json(user ? { mustChangePassword: user.mustChangePassword } : { error: "unauthorized" }, { status: user ? 200 : 401, headers: { "Cache-Control": "private, no-store" } });
}
