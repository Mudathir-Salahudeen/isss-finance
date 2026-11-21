import { DBorTx } from "@/db";
import { sql } from "drizzle-orm";

/** Gap-free, transaction-safe sequential number, e.g. RCT/2026/000123. Row-locked via upsert. */
export async function nextNumber(tx: DBorTx, prefix: string, opts: { year?: boolean; pad?: number } = {}): Promise<string> {
  const year = new Date().getFullYear();
  const key = opts.year === false ? prefix : `${prefix}/${year}`;
  const res = await tx.execute(sql`INSERT INTO counters (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`);
  const n = Number((res.rows[0] as { value: number }).value);
  return `${key}/${String(n).padStart(opts.pad ?? 6, "0")}`;
}
