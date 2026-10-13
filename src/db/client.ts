import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const holder = globalThis as typeof globalThis & { __marketPool?: Pool; __marketRatePool?: Pool };
const pool = process.env.NODE_ENV !== "production" && holder.__marketPool
  ? holder.__marketPool : new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") holder.__marketPool = pool;
export const rootDb = drizzle({ client: pool, schema });
// Counters must progress even when auth transactions occupy the business pool.
const ratePool = process.env.NODE_ENV !== "production" && holder.__marketRatePool
  ? holder.__marketRatePool : new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
if (process.env.NODE_ENV !== "production") holder.__marketRatePool = ratePool;
export const rateLimitDb = drizzle({ client: ratePool });
type Transaction = Parameters<Parameters<typeof rootDb.transaction>[0]>[0];
const transactions = new AsyncLocalStorage<Transaction>();
// Keep Better Auth's adapter, hooks and our security audit in the same transaction.
export const db: typeof rootDb = new Proxy(rootDb, {
  get(target, property) {
    const connection = transactions.getStore() ?? target;
    const value = Reflect.get(connection, property);
    return typeof value === "function" ? value.bind(connection) : value;
  },
});
export async function inDatabaseTransaction<T>(operation: () => Promise<T>) {
  if (transactions.getStore()) return operation();
  return rootDb.transaction(tx => transactions.run(tx, operation));
}
