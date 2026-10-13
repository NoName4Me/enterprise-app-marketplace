import {drizzle} from "drizzle-orm/node-postgres";
import {Pool} from "pg";
import * as schema from "./schema";
if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const holder=globalThis as typeof globalThis & {__marketPool?:Pool};
const pool=process.env.NODE_ENV!=="production" && holder.__marketPool
 ? holder.__marketPool : new Pool({connectionString:process.env.DATABASE_URL,max:10});
if(process.env.NODE_ENV!=="production") holder.__marketPool=pool;
export const db=drizzle({client:pool,schema});
