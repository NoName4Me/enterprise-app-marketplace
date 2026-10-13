import "dotenv/config";
import { auth } from "../src/lib/auth";
const url = new URL(process.env.DATABASE_URL!);
if (process.env.CI !== "true" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/market_test") throw new Error("Only the isolated CI fixture database may be prepared");
async function run() {
  const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email: "t01-admin@example.test", password: "CI-only-test-password-not-a-real-secret-123!" }) }));
  if (!response.ok) throw new Error("Fixture admin sign-in failed");
  const cookie = (response.headers.get("set-cookie")?.split(",").find(x => x.includes("session_token")) ?? "").trim().split(";")[0];
  const changed = await auth.handler(new Request("http://localhost:3000/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie }, body: JSON.stringify({ currentPassword: "CI-only-test-password-not-a-real-secret-123!", newPassword: "CI-only-changed-admin-password-not-a-real-secret-456!" }) }));
  if (!changed.ok) throw new Error("Fixture first password change failed");
  console.log("CI administrator completed first password change.");
}
run().then(() => process.exit(0)).catch(() => { console.error("CI administrator preparation failed"); process.exit(1); });
