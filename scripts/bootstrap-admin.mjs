import "dotenv/config";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string", default: "Administrator" },
    "ci-test-password": { type: "string" },
  },
  strict: true,
});
const email = values.email?.trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Provide a valid --email argument.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const credentials = [];
if (values["ci-test-password"] !== undefined) {
  const db = new URL(process.env.DATABASE_URL);
  const isFixture = process.env.CI === "true"
    && ["localhost", "127.0.0.1"].includes(db.hostname)
    && db.pathname === "/market_test";
  if (!isFixture) throw new Error("Non-interactive fixture credentials are CI-only.");
  credentials.push("--password", values["ci-test-password"]);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // Session-level advisory lock spans the external CLI process, ensuring a
  // concurrent bootstrap cannot both observe an empty user table.
  await client.query("SELECT pg_advisory_lock(4739201)");
  const existing = await client.query('SELECT COUNT(*)::int AS total FROM "user"');
  if (existing.rows[0]?.total !== 0) {
    throw new Error("Bootstrap refused: database already contains users.");
  }
  const result = spawnSync("pnpm", [
    "dlx", "auth@1.7.6", "create-admin",
    "--config", "./src/lib/auth.ts",
    "--email", email,
    "--name", values.name,
    "--role", "admin",
    ...credentials,
  ], { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Better Auth administrator creation failed.");
  }
  const verified = await client.query(
    'SELECT COUNT(*)::int AS total FROM "user" WHERE email = $1 AND role = $2',
    [email, "admin"],
  );
  if (verified.rows[0]?.total !== 1) {
    throw new Error("Bootstrap did not create exactly one expected admin.");
  }
  process.stdout.write("Initial administrator created.\n");
} finally {
  try { await client.query("SELECT pg_advisory_unlock(4739201)"); }
  finally { await client.end(); }
}
