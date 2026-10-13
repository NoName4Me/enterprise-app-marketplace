import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "./active-user";
export async function getPageUser(headers: Headers) {
  const user = await getAuthenticatedUser(headers);
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/security");
  return user;
}
