import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";

// DATE columns stay "YYYY-MM-DD" strings (no timezone shifting); BIGINT (kobo) parsed to exact JS integers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT out of safe range: ${v}`);
  return n;
});
import * as schema from "./schema";
import { pgConfig } from "./connection";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DBorTx = DB | Tx;

const g = globalThis as unknown as { __sfmsPool?: Pool; __sfmsDb?: DB };

function init(): DB {
  if (!g.__sfmsDb) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Attach the database (see DEPLOY.md) and redeploy.");
    // Serverless (Vercel) runs many small instances: keep each pool tiny and use the provider's pooled URL.
    g.__sfmsPool = new Pool({ ...pgConfig(url), max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 10_000 });
    g.__sfmsDb = drizzle(g.__sfmsPool, { schema });
  }
  return g.__sfmsDb;
}

/** Lazily-initialised database handle (so tests can set DATABASE_URL first). */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = init() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export async function closeDb() {
  await g.__sfmsPool?.end();
  g.__sfmsPool = undefined;
  g.__sfmsDb = undefined;
}

export { schema };
