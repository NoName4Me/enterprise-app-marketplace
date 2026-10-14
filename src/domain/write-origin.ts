import { AppError } from "./app-errors";

/** Never trust Host or forwarded headers to choose a cookie-write origin.
 * Next standalone constructs Request.url using its internal listen address.
 * The auth base URL is the configured, trusted public application origin.
 */
export function assertWriteOrigin(request: Request) {
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured || request.headers.get("origin") !== new URL(configured).origin) throw new AppError(403, "forbidden");
}
