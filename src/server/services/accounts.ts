import { db, DBorTx } from "@/db";
import { accounts, accountTransactions, transfers, accountUsers, users } from "@/db/schema";
import { and, asc, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { Actor, can, requirePerm } from "../actor";
import { audit } from "../audit";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseNaira } from "@/lib/money";
import { parseDateInput, todayISO } from "@/lib/dates";

export function maskAccountNumber(n: string | null | undefined) {
  if (!n) return "";
  return n.length <= 4 ? n : `${"•".repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;
}

export async function listAccounts(opts: { activeOnly?: boolean } = {}) {
  const rows = await db.select().from(accounts).where(opts.activeOnly ? eq(accounts.active, true) : undefined).orderBy(asc(accounts.type), asc(accounts.name));
  return rows;
}

/** Accounts this actor may record transactions into. Restricted accounts need explicit assignment or accounts.view_all. */
export async function accessibleAccounts(actor: Actor) {
  const all = await listAccounts({ activeOnly: true });
  if (can(actor, "accounts.view_all")) return all;
  const mine = new Set((await db.select().from(accountUsers).where(eq(accountUsers.userId, actor.id))).map((r) => r.accountId));
  return all.filter((a) => !a.restricted || mine.has(a.id) || a.custodianUserId === actor.id);
}

export async function assertAccountAccess(tx: DBorTx, actor: Actor, accountId: number) {
  const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a) throw new ValidationError("Account not found", { accountId: "Unknown account" });
  if (!a.active) throw new ValidationError("This account is inactive", { accountId: "Inactive account" });
  if (a.restricted && !can(actor, "accounts.view_all") && a.custodianUserId !== actor.id) {
    const [m] = await tx.select().from(accountUsers).where(and(eq(accountUsers.accountId, accountId), eq(accountUsers.userId, actor.id)));
    if (!m) throw new ForbiddenError("You are not permitted to use this account.");
  }
  return a;
}

const accountSchema = z.object({
  name: z.string().trim().min(2, "Account name is required"),
  provider: z.string().trim().default(""),
  accountNumber: z.string().trim().default("").refine((v) => !v || /^[0-9A-Za-z-]{4,20}$/.test(v), "Invalid account number"),
  type: z.enum(["bank", "cash", "pos", "other"]),
  currency: z.string().trim().default("NGN"),
  openingBalance: z.string().default("0"),
  openingDate: z.string().optional().nullable(),
  active: z.boolean().default(true),
  restricted: z.boolean().default(false),
  custodianUserId: z.coerce.number().int().positive().nullable().optional(),
  userIds: z.array(z.number()).default([]),
});

export async function saveAccount(actor: Actor, id: number | null, input: z.input<typeof accountSchema>) {
  requirePerm(actor, "accounts.manage");
  const d = accountSchema.parse(input);
  const opening = parseNaira(d.openingBalance || "0");
  if (opening === null) throw new ValidationError("Invalid opening balance", { openingBalance: "Invalid amount" });
  const openingDate = parseDateInput(d.openingDate) ?? todayISO();
  return db.transaction(async (tx) => {
    const values = { name: d.name, provider: d.provider, accountNumber: d.accountNumber, type: d.type, currency: d.currency, openingBalance: opening,
      openingDate, active: d.active, restricted: d.restricted, custodianUserId: d.custodianUserId ?? null };
    let old = null;
    if (id) {
      [old] = await tx.select().from(accounts).where(eq(accounts.id, id));
      if (!old) throw new NotFoundError("Account");
      if (old.openingBalance !== opening || old.openingDate !== openingDate) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(accountTransactions).where(eq(accountTransactions.accountId, id));
        const [{ r }] = (await tx.execute(sql`SELECT count(*)::int AS r FROM reconciliations WHERE account_id = ${id} AND status = 'reconciled'`)).rows as { r: number }[];
        if (n > 0 && r > 0) throw new AppError("Opening balance cannot change after a period has been reconciled.");
      }
      await tx.update(accounts).set(values).where(eq(accounts.id, id));
    } else {
      id = (await tx.insert(accounts).values(values).returning())[0].id;
    }
    await tx.delete(accountUsers).where(eq(accountUsers.accountId, id));
    if (d.userIds.length) await tx.insert(accountUsers).values(d.userIds.map((u) => ({ accountId: id!, userId: u })));
    await audit(tx, actor, { action: old ? "account_updated" : "account_created", module: "accounts", recordType: "account", recordId: id,
      oldValues: old ? { ...old, accountNumber: maskAccountNumber(old.accountNumber) } : undefined, newValues: { ...values, accountNumber: maskAccountNumber(values.accountNumber), userIds: d.userIds } });
    return id;
  });
}

/** Insert a book-ledger row. Idempotent per (sourceType, sourceId, kind). Returns the row id (existing or new). */
export async function postTxn(tx: DBorTx, actor: Actor, t: { accountId: number; txnDate: string; amount: number; kind: string; sourceType: string; sourceId: number; description: string; reference?: string; categoryName?: string }) {
  await assertNotLocked(tx, t.accountId, t.txnDate);
  const ins = await tx.insert(accountTransactions).values({ ...t, reference: t.reference ?? "", createdBy: actor.id }).onConflictDoNothing().returning({ id: accountTransactions.id });
  if (ins[0]) return ins[0].id;
  const [ex] = await tx.select({ id: accountTransactions.id }).from(accountTransactions)
    .where(and(eq(accountTransactions.sourceType, t.sourceType), eq(accountTransactions.sourceId, t.sourceId), eq(accountTransactions.kind, t.kind)));
  return ex.id;
}

/** Transactions cannot be posted into a reconciled (locked) period. */
export async function assertNotLocked(tx: DBorTx, accountId: number, date: string) {
  const r = await tx.execute(sql`SELECT id, period_start, period_end FROM reconciliations WHERE account_id = ${accountId} AND status = 'reconciled'
    AND ${date}::date BETWEEN period_start AND period_end LIMIT 1`);
  if (r.rows.length) {
    const row = r.rows[0] as { period_start: string; period_end: string };
    throw new AppError(`The period ${String(row.period_start).slice(0, 10)} to ${String(row.period_end).slice(0, 10)} is reconciled and locked for this account. Use a date outside it, or reopen the reconciliation.`);
  }
}

export async function bookBalance(accountId: number, asOf?: string, tx: DBorTx = db): Promise<number> {
  const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a) throw new NotFoundError("Account");
  const r = await tx.execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM account_transactions WHERE account_id = ${accountId} ${asOf ? sql`AND txn_date <= ${asOf}` : sql``}`);
  return a.openingBalance + Number((r.rows[0] as { s: string }).s);
}

export async function accountBalances(asOf?: string) {
  const accs = await listAccounts();
  const sums = await db.execute(sql`SELECT account_id, COALESCE(SUM(amount),0)::bigint AS s,
      MAX(txn_date) AS last FROM account_transactions ${asOf ? sql`WHERE txn_date <= ${asOf}` : sql``} GROUP BY account_id`);
  const last = await db.execute(sql`SELECT DISTINCT ON (account_id) account_id, statement_balance, period_end, status FROM reconciliations
      WHERE status = 'reconciled' ORDER BY account_id, period_end DESC`);
  const unmatched = await db.execute(sql`SELECT account_id, count(*)::int AS n FROM statement_lines WHERE status = 'unmatched' GROUP BY account_id`);
  return accs.map((a) => {
    const s = (sums.rows as { account_id: number; s: string; last: string }[]).find((x) => x.account_id === a.id);
    const rec = (last.rows as { account_id: number; statement_balance: string; period_end: string }[]).find((x) => x.account_id === a.id);
    return {
      ...a, accountNumberMasked: maskAccountNumber(a.accountNumber),
      bookBalance: a.openingBalance + Number(s?.s ?? 0),
      lastReconciledBalance: rec ? Number(rec.statement_balance) : null,
      lastReconciledDate: rec ? String(rec.period_end).slice(0, 10) : null,
      unmatchedLines: (unmatched.rows as { account_id: number; n: number }[]).find((x) => x.account_id === a.id)?.n ?? 0,
    };
  });
}

export async function accountTransactionsList(accountId: number, f: { from?: string; to?: string } = {}) {
  const conds = [eq(accountTransactions.accountId, accountId)];
  if (f.from) conds.push(gte(accountTransactions.txnDate, f.from));
  if (f.to) conds.push(lte(accountTransactions.txnDate, f.to));
  const rows = await db.select({ t: accountTransactions, by: users.fullName }).from(accountTransactions)
    .leftJoin(users, eq(users.id, accountTransactions.createdBy)).where(and(...conds)).orderBy(asc(accountTransactions.txnDate), asc(accountTransactions.id));
  const opening = f.from ? await bookBalance(accountId, new Date(Date.parse(f.from) - 86400000).toISOString().slice(0, 10)) : (await db.select().from(accounts).where(eq(accounts.id, accountId)))[0]?.openingBalance ?? 0;
  let bal = opening;
  const matched = new Set((await db.execute(sql`SELECT account_txn_id FROM recon_matches WHERE active AND account_txn_id IS NOT NULL`)).rows.map((r) => (r as { account_txn_id: number }).account_txn_id));
  return {
    opening,
    rows: rows.map((r) => { bal += r.t.amount; return { ...r.t, createdByName: r.by, runningBalance: bal, reconciled: matched.has(r.t.id) }; }),
    closing: bal,
  };
}

// ───────── Transfers (never income or expense) ─────────

export async function createTransfer(actor: Actor, input: { fromAccountId: number; toAccountId: number; amount: string; transferDate: string; reference?: string; notes?: string }) {
  requirePerm(actor, "transfers.create");
  const amount = parseNaira(input.amount);
  if (!amount || amount <= 0) throw new ValidationError("Enter a positive amount", { amount: "Invalid amount" });
  if (input.fromAccountId === input.toAccountId) throw new ValidationError("Choose two different accounts.");
  const date = parseDateInput(input.transferDate);
  if (!date) throw new ValidationError("Invalid date", { transferDate: "Invalid date" });
  return db.transaction(async (tx) => {
    await assertAccountAccess(tx, actor, input.fromAccountId);
    await assertAccountAccess(tx, actor, input.toAccountId);
    const [t] = await tx.insert(transfers).values({ fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount, transferDate: date,
      reference: input.reference ?? "", notes: input.notes ?? "", createdBy: actor.id }).returning();
    await postTxn(tx, actor, { accountId: t.fromAccountId, txnDate: date, amount: -amount, kind: "transfer_out", sourceType: "transfer", sourceId: t.id, description: `Transfer out${input.notes ? ": " + input.notes : ""}`, reference: t.reference ?? "" });
    await postTxn(tx, actor, { accountId: t.toAccountId, txnDate: date, amount, kind: "transfer_in", sourceType: "transfer", sourceId: t.id, description: `Transfer in${input.notes ? ": " + input.notes : ""}`, reference: t.reference ?? "" });
    await audit(tx, actor, { action: "transfer_created", module: "accounts", recordType: "transfer", recordId: t.id, newValues: t });
    return t.id;
  });
}

export async function reverseTransfer(actor: Actor, id: number, reason: string) {
  requirePerm(actor, "transfers.create");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, id));
    if (!t) throw new NotFoundError("Transfer");
    if (t.status !== "posted") throw new AppError("Already reversed.");
    const date = todayISO();
    await postTxn(tx, actor, { accountId: t.fromAccountId, txnDate: date, amount: t.amount, kind: "transfer_out_reversal", sourceType: "transfer", sourceId: t.id, description: `Reversal of transfer #${t.id}: ${reason}` });
    await postTxn(tx, actor, { accountId: t.toAccountId, txnDate: date, amount: -t.amount, kind: "transfer_in_reversal", sourceType: "transfer", sourceId: t.id, description: `Reversal of transfer #${t.id}: ${reason}` });
    await tx.update(transfers).set({ status: "reversed", reversedAt: new Date(), reversedBy: actor.id, reversalReason: reason }).where(eq(transfers.id, id));
    await audit(tx, actor, { action: "transfer_reversed", module: "accounts", recordType: "transfer", recordId: id, reason });
  });
}

export async function listTransfers() {
  return db.execute(sql`SELECT t.*, fa.name AS from_name, ta.name AS to_name, u.full_name AS created_by_name
    FROM transfers t JOIN accounts fa ON fa.id = t.from_account_id JOIN accounts ta ON ta.id = t.to_account_id JOIN users u ON u.id = t.created_by
    ORDER BY t.transfer_date DESC, t.id DESC`).then((r) => r.rows as Record<string, unknown>[]);
}

export async function accountsByIds(ids: number[]) {
  return ids.length ? db.select().from(accounts).where(inArray(accounts.id, ids)) : [];
}

export { desc };
