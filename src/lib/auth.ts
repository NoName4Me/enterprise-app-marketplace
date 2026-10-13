import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, inDatabaseTransaction, rootDb } from "@/db/client";
import * as schema from "@/db/schema";
import { authRateStorage, sensitiveActions } from "./security-policy";
import { mayReviewApp } from "./access";
import { AppError, httpErrorResponse, readObjectJson } from "@/domain/app-errors";

const baseURL = process.env.BETTER_AUTH_URL;
if (!baseURL) throw new Error("BETTER_AUTH_URL is required");
const origin = new URL(baseURL).origin;
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
type AccountState = { role: string | null; banned: boolean | null; canCreateApp: boolean; mustChangePassword: boolean };
function snapshot(record: AccountState) {
  return { role: record.role, banned: record.banned, canCreateApp: record.canCreateApp, mustChangePassword: record.mustChangePassword };
}
const recovery = new AsyncLocalStorage<{ targetId: string; url?: string }>();
const operations = new AsyncLocalStorage<{ actorId?: string; targetId?: string; before?: ReturnType<typeof snapshot> }>();
async function invalidateRecovery(userId: string) {
  await db.delete(schema.verification).where(and(eq(schema.verification.value, userId), like(schema.verification.identifier, "reset-password:%")));
}
const nativeAuth = betterAuth({
  secret, baseURL, trustedOrigins: [origin],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  logger: { disabled: true },
  session: { cookieCache: { enabled: false } },
  emailAndPassword: {
    enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, token }) {
      const context = recovery.getStore();
      if (!context || context.targetId !== user.id) throw new APIError("FORBIDDEN", { message: "请联系管理员重置密码" });
      // URL fragments never reach HTTP access logs or referrer headers.
      context.url = `${origin}/reset-password#token=${encodeURIComponent(token)}`;
    },
    async onPasswordReset({ user }) {
      await db.update(schema.user).set({ mustChangePassword: false }).where(eq(schema.user.id, user.id));
      await invalidateRecovery(user.id);
      await db.insert(schema.securityEvents).values({ actorUserId: user.id, targetUserId: user.id, action: "PASSWORD_RESET_COMPLETED", after: { mustChangePassword: false } });
    },
  },
  user: { additionalFields: {
    canCreateApp: { type: "boolean", defaultValue: false, input: false },
    mustChangePassword: { type: "boolean", defaultValue: true, input: false },
  } },
  // Without a configured, overwritten proxy header the library uses a shared bucket.
  advanced: { ipAddress: { ipAddressHeaders: process.env.AUTH_TRUSTED_IP_HEADER ? [process.env.AUTH_TRUSTED_IP_HEADER] : [] } },
  rateLimit: {
    enabled: true, window: 60, max: 120, customStorage: authRateStorage,
    customRules: { "/sign-in/email": { window: 60, max: 20 }, "/reset-password": { window: 300, max: 10 }, "/change-password": { window: 300, max: 10 } },
  },
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (ctx.path === "/sign-in/email" && typeof ctx.body?.email === "string") {
        const limited = await authRateStorage.consume!("login-email:" + ctx.body.email.trim().toLowerCase(), { window: 300, max: 10 });
        if (!limited.allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "登录尝试过于频繁，请稍后重试" });
      }
      if (ctx.path === "/request-password-reset" && !recovery.getStore()) throw new APIError("FORBIDDEN", { message: "请联系管理员核实身份并重置密码" });
      if (["/admin/set-user-password", "/admin/impersonate-user", "/admin/stop-impersonating"].includes(ctx.path)) throw new APIError("FORBIDDEN", { message: "请使用受控账号管理流程" });
      if (ctx.path === "/reset-password" && typeof ctx.body?.token !== "string") throw new APIError("BAD_REQUEST", { message: "请使用有效重置链接" });
      if (ctx.path === "/admin/create-user" && Object.keys(ctx.body?.data ?? {}).some(key => !["image"].includes(key))) throw new APIError("FORBIDDEN", { message: "敏感字段必须使用专用管理入口" });
      if (ctx.path === "/change-password") {
        if (ctx.body?.currentPassword === ctx.body?.newPassword) throw new APIError("BAD_REQUEST", { message: "新密码不能与原密码相同" });
        ctx.body.revokeOtherSessions = true;
      }
      // Session resolution is allowed even for an account awaiting its first password change.
      if (["/get-session", "/sign-in/email", "/sign-out", "/reset-password", "/request-password-reset"].includes(ctx.path) || ctx.path.startsWith("/reset-password/")) return;
      const current = await getSessionFromCtx(ctx);
      // Official trusted server provisioning (bootstrap/demo) has no request or session.
      if (!current && ctx.path === "/admin/create-user" && !ctx.request && !ctx.headers?.get("cookie")) return;
      if (!current) return; // Library middleware denies anonymous protected endpoints.
      const [record] = await db.select().from(schema.user).where(eq(schema.user.id, current.user.id)).limit(1);
      if (!record || record.banned) throw new APIError("UNAUTHORIZED", { message: "账号不可用" });
      if (record.mustChangePassword && ctx.path !== "/change-password") throw new APIError("FORBIDDEN", { message: "请先修改初始密码", code: "PASSWORD_CHANGE_REQUIRED" });
      if (ctx.path.startsWith("/admin/") && !mayReviewApp(record)) throw new APIError("FORBIDDEN", { message: "需要管理员权限" });
      // Replace any session-cached role with live server-side rights.
      ctx.context.session = { ...current, user: { ...current.user, role: record.role ?? "user", banned: Boolean(record.banned) } };
      if (ctx.path === "/admin/update-user" && Object.keys(ctx.body?.data ?? {}).some(key => !["name", "image"].includes(key))) throw new APIError("FORBIDDEN", { message: "敏感字段必须使用专用管理入口" });
      if (sensitiveActions[ctx.path]) {
        let targetId = typeof ctx.body?.userId === "string" ? ctx.body.userId : record.id;
        if (ctx.path === "/admin/revoke-user-session" && typeof ctx.body?.sessionToken === "string") {
          const [targetSession] = await db.select({ userId: schema.session.userId }).from(schema.session).where(eq(schema.session.token, ctx.body.sessionToken)).limit(1);
          if (targetSession) targetId = targetSession.userId;
        }
        const [target] = await db.select().from(schema.user).where(eq(schema.user.id, targetId)).limit(1);
        Object.assign(operations.getStore() ?? {}, { actorId: record.id, targetId, before: target ? snapshot(target) : undefined });
      }
    }),
    after: createAuthMiddleware(async ctx => {
      const returned = ctx.context.returned;
      if (returned instanceof APIError || (returned instanceof Response && !returned.ok)) return;
      if (ctx.path === "/sign-in/email" && ctx.context.newSession) {
        await db.insert(schema.securityEvents).values({ actorUserId: ctx.context.newSession.user.id, targetUserId: ctx.context.newSession.user.id, action: "LOGIN_SUCCEEDED" });
      }
      const action = sensitiveActions[ctx.path];
      if (!action) return;
      const operation = operations.getStore();
      const created = returned as { user?: { id?: string } } | undefined;
      const targetId = ctx.path === "/admin/create-user" ? created?.user?.id : operation?.targetId;
      if (!targetId) return;
      if (ctx.path === "/change-password" || ctx.path === "/admin/create-user") {
        await db.update(schema.user).set({ mustChangePassword: ctx.path === "/admin/create-user" && Boolean(ctx.body?.password) }).where(eq(schema.user.id, targetId));
      }
      if (["/admin/ban-user", "/change-password", "/admin/remove-user"].includes(ctx.path)) await invalidateRecovery(targetId);
      const [target] = await db.select().from(schema.user).where(eq(schema.user.id, targetId)).limit(1);
      await db.insert(schema.securityEvents).values({ actorUserId: operation?.actorId, targetUserId: targetId, action, before: operation?.before, after: target ? snapshot(target) : null });
    }),
  },
  plugins: [admin()],
});
class RollbackResponse { constructor(readonly response: Response) {} }
async function handleAuth(request: Request) {
  if (request.method !== "POST") return nativeAuth.handler(request);
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  const operation: { actorId?: string; targetId?: string; before?: ReturnType<typeof snapshot> } = {};
  try {
    const body = await readObjectJson(request.clone(), true);
    return await inDatabaseTransaction(() => operations.run(operation, async () => {
      const current = await nativeAuth.api.getSession({ headers: request.headers });
      Object.assign(operations.getStore()!, { actorId: current?.user.id, targetId: current?.user.id });
      const ids = [current?.user.id, typeof body.userId === "string" ? body.userId : undefined].filter((id): id is string => Boolean(id));
      if (path === "/sign-in/email" && typeof body.email === "string") {
        const [found] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, body.email.trim().toLowerCase())).limit(1);
        if (found) ids.push(found.id);
      }
      if (path === "/reset-password" && typeof body.token === "string") {
        const [token] = await db.select({ userId: schema.verification.value }).from(schema.verification).where(eq(schema.verification.identifier, "reset-password:" + body.token)).limit(1);
        if (token) ids.push(token.userId);
      }
      // Serialize login/password changes on the same account; consistent lock order for admin operations.
      if (ids.length) await db.select({ id: schema.user.id }).from(schema.user).where(inArray(schema.user.id, [...new Set(ids)])).orderBy(schema.user.id).for("update");
      const response = await nativeAuth.handler(request);
      if (!response.ok) throw new RollbackResponse(response);
      return response;
    }));
  } catch (error) {
    if (path === "/sign-in/email") await rootDb.insert(schema.securityEvents).values({ action: "LOGIN_FAILED" });
    if (sensitiveActions[path]) await rootDb.insert(schema.securityEvents).values({ actorUserId: operation.actorId, targetUserId: operation.targetId, action: sensitiveActions[path] + "_REJECTED", before: operation.before });
    if (error instanceof RollbackResponse) return error.response;
    if (error instanceof AppError) return httpErrorResponse(error);
    return Response.json({ error: "operation_failed", message: "操作失败，请稍后重试" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
export const auth = { ...nativeAuth, handler: handleAuth };
export async function issueRecoveryLink(targetId: string, email: string, headers: Headers) {
  const context: { targetId: string; url?: string } = { targetId };
  await recovery.run(context, () => nativeAuth.api.requestPasswordReset({ headers, body: { email, redirectTo: `${process.env.BETTER_AUTH_URL}/reset-password` } }));
  if (!context.url) throw new Error("Recovery link was not issued");
  return context.url;
}
