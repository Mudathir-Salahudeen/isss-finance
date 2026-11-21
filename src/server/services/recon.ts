/**
 * Bank & cash reconciliation.
 * IMPORTANT: matching a bank credit to a PENDING student payment only links it as evidence for the Director.
 * It never approves the payment. Once the Director approves, the payment posts to the book and can be matched normally.
 */
import { db, DBorTx } from "@/db";
import { bankStatements, statementLines, reconMatches, reconciliations, accountTransactions, accounts, payments, users } from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Actor, requirePerm } from "../actor";
import { audit, notify, usersWithPermission } from "../audit";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatNaira, parseNaira } from "@/lib/money";
import { parseDateInput, addDays } from "@/lib/dates";
import { bookBalance, postTxn } from "./accounts";
import { Sheet } from "@/lib/spreadsheet";

/** pg returns DATE columns as JS Date (local midnight) or string; normalise to YYYY-MM-DD. */
export function isoOf(v: unknown): string {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export const STATEMENT_FIELDS = [
  { key: "date", label: "Transaction date", required: true, aliases: ["date", "trans date", "transaction date", "value date", "posting date", "txn date"] },
  { key: "description", label: "Description / narration", required: false, aliases: ["description", "narration", "details", "remarks", "particulars"] },
  { key: "reference", label: "Reference", required: false, aliases: ["reference", "ref", "ref no", "reference number", "cheque no", "transaction id", "session id"] },
  { key: "credit", label: "Credit (money in)", required: false, aliases: ["credit", "credits", "deposit", "deposits", "money in", "lodgement", "cr"] },
  { key: "debit", label: "Debit (money out)", required: false, aliases: ["debit", "debits", "withdrawal", "withdrawals", "money out", "dr"] },
  { key: "amount", label: "Signed amount (+in / −out)", required: false, aliases: ["amount", "signed amount"] },
  { key: "balance", label: "Running balance", required: false, aliases: ["balance", "running balance", "closing balance", "bal"] },
];

export function suggestStatementMapping(headers: string[]) {
  const m: Record<string, string> = {};
  for (const f of STATEMENT_FIELDS) {
    const h = headers.find((x) => f.aliases.includes(x.trim().toLowerCase()));
    if (h) m[f.key] = h;
  }
  return m;
}

export function parseStatementRows(sheet: Sheet, mapping: Record<string, string>) {
  if (!mapping.date) throw new ValidationError("Map the transaction date column.");
  if (!mapping.amount && !mapping.credit && !mapping.debit) throw new ValidationError("Map either Credit/Debit columns or a signed Amount column.");
  const idx = (k: string) => (mapping[k] ? sheet.headers.indexOf(mapping[k]) : -1);
  const out: { row: number; date: string | null; description: string; reference: string; amount: number | null; balance: number | null; error?: string }[] = [];
  sheet.rows.forEach((r, i) => {
    const get = (k: string) => (idx(k) >= 0 ? r[idx(k)] : null);
    const date = parseDateInput(get("date"));
    let amount: number | null = null;
    if (mapping.amount) amount = parseNaira(get("amount"));
    else {
      const cr = get("credit") !== null && String(get("credit")).trim() !== "" ? parseNaira(get("credit")) : 0;
      const dr = get("debit") !== null && String(get("debit")).trim() !== "" ? parseNaira(get("debit")) : 0;
      amount = cr === null || dr === null ? null : (cr ?? 0) - Math.abs(dr ?? 0);
    }
    const bal = get("balance") !== null && String(get("balance")).trim() !== "" ? parseNaira(get("balance")) : null;
    const errs = [];
    if (!date) errs.push("invalid date");
    if (amount === null) errs.push("invalid amount");
    else if (amount === 0) errs.push("zero amount");
    out.push({ row: i + 2, date, description: String(get("description") ?? "").trim(), reference: String(get("reference") ?? "").trim(), amount, balance: bal, error: errs.join(", ") || undefined });
  });
  return out;
}

export async function importStatement(actor: Actor, accountId: number, fileName: string, sheet: Sheet, mapping: Record<string, string>) {
  requirePerm(actor, "recon.manage");
  const rows = parseStatementRows(sheet, mapping);
  const good = rows.filter((r) => !r.error);
  if (!good.length) throw new ValidationError("No valid statement lines were found. Check the column mapping.");
  return db.transaction(async (tx) => {
    const [acc] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (!acc) throw new NotFoundError("Account");
    const dates = good.map((r) => r.date!).sort();
    const [st] = await tx.insert(bankStatements).values({ accountId, fileName, uploadedBy: actor.id, periodStart: dates[0], periodEnd: dates[dates.length - 1], lineCount: good.length,
      closingBalance: [...good].reverse().find((r) => r.balance !== null)?.balance ?? null }).returning();
    let dupCount = 0;
    for (const r of good) {
      const dup = await tx.execute(sql`SELECT 1 FROM statement_lines WHERE account_id = ${accountId} AND line_date = ${r.date} AND amount = ${r.amount}
        AND COALESCE(reference,'') = ${r.reference} AND COALESCE(description,'') = ${r.description} AND status <> 'duplicate' LIMIT 1`);
      const isDup = dup.rows.length > 0;
      if (isDup) dupCount++;
      await tx.insert(statementLines).values({ statementId: st.id, accountId, lineDate: r.date!, description: r.description, reference: r.reference, amount: r.amount!,
        runningBalance: r.balance, status: isDup ? "duplicate" : "unmatched", note: isDup ? "Same date, amount, reference and description as a line already imported" : null });
    }
    await tx.update(bankStatements).set({ duplicateCount: dupCount }).where(eq(bankStatements.id, st.id));
    await audit(tx, actor, { action: "bank_statement_imported", module: "reconciliation", recordType: "bank_statement", recordId: st.id,
      newValues: { accountId, fileName, lines: good.length, duplicates: dupCount, rejectedRows: rows.length - good.length } });
    return { statementId: st.id, imported: good.length, duplicates: dupCount, rejected: rows.filter((r) => r.error) };
  });
}

async function assertLineOpen(tx: DBorTx, lineId: number) {
  const [l] = await tx.select().from(statementLines).where(eq(statementLines.id, lineId)).for("update");
  if (!l) throw new NotFoundError("Statement line");
  const locked = await tx.execute(sql`SELECT 1 FROM reconciliations WHERE account_id = ${l.accountId} AND status = 'reconciled' AND ${l.lineDate}::date BETWEEN period_start AND period_end`);
  if (locked.rows.length) throw new AppError("This line falls in a reconciled (locked) period. Reopen the reconciliation first.");
  return l;
}

/** Auto-match unmatched lines to book transactions on same account, same amount, ±window days; reference match wins. */
export async function autoMatch(actor: Actor, accountId: number, opts: { from?: string; to?: string; windowDays?: number } = {}) {
  requirePerm(actor, "recon.manage");
  const win = opts.windowDays ?? 5;
  return db.transaction(async (tx) => {
    const lines = await tx.execute(sql`SELECT * FROM statement_lines WHERE account_id = ${accountId} AND status = 'unmatched'
      ${opts.from ? sql`AND line_date >= ${opts.from}` : sql``} ${opts.to ? sql`AND line_date <= ${opts.to}` : sql``} ORDER BY line_date, id`);
    let matched = 0, evidence = 0;
    const used = new Set<number>();
    for (const l of lines.rows as { id: number; line_date: unknown; amount: string; reference: string; description: string }[]) {
      const ld = isoOf(l.line_date);
      const locked = await tx.execute(sql`SELECT 1 FROM reconciliations WHERE account_id = ${accountId} AND status = 'reconciled' AND ${ld}::date BETWEEN period_start AND period_end`);
      if (locked.rows.length) continue;
      const cands = await tx.execute(sql`SELECT t.id, t.txn_date, t.reference, t.description FROM account_transactions t
        WHERE t.account_id = ${accountId} AND t.amount = ${Number(l.amount)} AND t.txn_date BETWEEN ${addDays(ld, -win)} AND ${addDays(ld, win)}
          AND NOT EXISTS (SELECT 1 FROM recon_matches m WHERE m.active AND m.account_txn_id = t.id)`);
      const rows = (cands.rows as { id: number; txn_date: unknown; reference: string; description: string }[]).filter((c) => !used.has(c.id));
      const ref = (l.reference || "").trim().toLowerCase();
      const desc = (l.description || "").toLowerCase();
      const scored = rows.map((c) => {
        const cref = (c.reference || "").trim().toLowerCase();
        let score = 0;
        if (cref && (cref === ref || desc.includes(cref) || (ref && ref.includes(cref)))) score += 100;
        score -= Math.abs(Date.parse(isoOf(c.txn_date)) - Date.parse(ld)) / 86400000;
        return { c, score };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0];
      const unique = best && (scored.length === 1 || best.score - scored[1].score >= 1 || best.score >= 100 && scored[1].score < 100);
      if (best && unique) {
        used.add(best.c.id);
        await tx.insert(reconMatches).values({ statementLineId: l.id, accountTxnId: best.c.id, method: "auto", matchedBy: actor.id });
        await tx.update(statementLines).set({ status: "matched" }).where(eq(statementLines.id, l.id));
        matched++;
        continue;
      }
      // Credits with no book entry: look for a PENDING payment as evidence (does NOT approve it).
      if (Number(l.amount) > 0) {
        const pend = await tx.execute(sql`SELECT p.id FROM payments p WHERE p.status = 'pending' AND p.account_id = ${accountId} AND p.amount = ${Number(l.amount)}
          AND p.payment_date BETWEEN ${addDays(ld, -win)} AND ${addDays(ld, win)}
          AND NOT EXISTS (SELECT 1 FROM recon_matches m WHERE m.active AND m.pending_payment_id = p.id)
          ORDER BY (CASE WHEN ${ref} <> '' AND lower(trim(p.reference)) = ${ref} THEN 0 ELSE 1 END), abs(p.payment_date - ${ld}::date) LIMIT 1`);
        const p = pend.rows[0] as { id: number } | undefined;
        if (p) {
          const ex = await tx.execute(sql`SELECT 1 FROM recon_matches WHERE active AND statement_line_id = ${l.id} AND pending_payment_id IS NOT NULL`);
          if (!ex.rows.length) {
            await tx.insert(reconMatches).values({ statementLineId: l.id, pendingPaymentId: p.id, method: "auto", matchedBy: actor.id });
            evidence++;
          }
        }
      }
    }
    await audit(tx, actor, { action: "recon_auto_match", module: "reconciliation", recordType: "account", recordId: accountId, newValues: { matched, evidenceLinks: evidence } });
    const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM statement_lines WHERE account_id = ${accountId} AND status = 'unmatched'`)).rows as { n: number }[];
    if (n > 0) {
      const people = (await usersWithPermission(tx, "recon.manage")).filter((u) => u !== actor.id);
      await notify(tx, [actor.id, ...people], { kind: "recon_exceptions", title: `${n} unmatched bank line(s) need attention`, link: `/reconciliation?accountId=${accountId}` });
    }
    return { matched, evidence, unmatched: n };
  });
}

export async function manualMatch(actor: Actor, lineId: number, accountTxnId: number, note = "") {
  requirePerm(actor, "recon.manage");
  return db.transaction(async (tx) => {
    const l = await assertLineOpen(tx, lineId);
    if (l.status !== "unmatched") throw new AppError(`This line is already ${l.status}.`);
    const [t] = await tx.select().from(accountTransactions).where(eq(accountTransactions.id, accountTxnId));
    if (!t || t.accountId !== l.accountId) throw new ValidationError("The book entry must be on the same account.");
    const used = await tx.select().from(reconMatches).where(and(eq(reconMatches.accountTxnId, accountTxnId), eq(reconMatches.active, true)));
    if (used.length) throw new ConflictError("That book entry is already matched to another statement line.");
    if (t.amount !== l.amount && !note.trim()) throw new ValidationError(`Amounts differ (${formatNaira(l.amount)} vs ${formatNaira(t.amount)}). Add a note explaining the match.`);
    await tx.insert(reconMatches).values({ statementLineId: lineId, accountTxnId, method: "manual", matchedBy: actor.id });
    await tx.update(statementLines).set({ status: "matched", note: note || l.note }).where(eq(statementLines.id, lineId));
    await audit(tx, actor, { action: "recon_manual_match", module: "reconciliation", recordType: "statement_line", recordId: lineId, newValues: { accountTxnId, note } });
  });
}

export async function unmatch(actor: Actor, lineId: number, reason: string) {
  requirePerm(actor, "recon.manage");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const l = await assertLineOpen(tx, lineId);
    await tx.update(reconMatches).set({ active: false, unmatchedAt: new Date(), unmatchedBy: actor.id }).where(and(eq(reconMatches.statementLineId, lineId), eq(reconMatches.active, true)));
    if (l.status === "matched" || l.status === "ignored") await tx.update(statementLines).set({ status: "unmatched" }).where(eq(statementLines.id, lineId));
    await audit(tx, actor, { action: "recon_unmatched", module: "reconciliation", recordType: "statement_line", recordId: lineId, reason });
  });
}

/** Record a bank charge / interest / other item that appears only on the statement, and match it. */
export async function categoriseLine(actor: Actor, lineId: number, kind: "bank_charge" | "interest" | "other_income" | "other_expense", categoryName: string, note: string) {
  requirePerm(actor, "recon.manage");
  return db.transaction(async (tx) => {
    const l = await assertLineOpen(tx, lineId);
    if (l.status !== "unmatched") throw new AppError(`This line is already ${l.status}.`);
    if ((kind === "bank_charge" || kind === "other_expense") && l.amount > 0) throw new ValidationError("A charge/expense must be a debit line.");
    if ((kind === "interest" || kind === "other_income") && l.amount < 0) throw new ValidationError("Income must be a credit line.");
    const label = { bank_charge: "Bank charges", interest: "Interest received", other_income: "Other income", other_expense: "Other expense" }[kind];
    const txnId = await postTxn(tx, actor, { accountId: l.accountId, txnDate: l.lineDate, amount: l.amount, kind, sourceType: "statement_line", sourceId: l.id,
      description: `${label}: ${l.description || ""}${note ? " — " + note : ""}`, reference: l.reference ?? "", categoryName: categoryName || label });
    await tx.insert(reconMatches).values({ statementLineId: lineId, accountTxnId: txnId, method: "manual", matchedBy: actor.id });
    await tx.update(statementLines).set({ status: "categorised", categorisedTxnId: txnId, note }).where(eq(statementLines.id, lineId));
    await audit(tx, actor, { action: "recon_line_categorised", module: "reconciliation", recordType: "statement_line", recordId: lineId, newValues: { kind, categoryName, amount: l.amount } });
  });
}

export async function ignoreLine(actor: Actor, lineId: number, reason: string) {
  requirePerm(actor, "recon.manage");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const l = await assertLineOpen(tx, lineId);
    if (!["unmatched", "duplicate"].includes(l.status)) throw new AppError("Only unmatched or duplicate lines can be ignored.");
    await tx.update(statementLines).set({ status: "ignored", note: reason }).where(eq(statementLines.id, lineId));
    await audit(tx, actor, { action: "recon_line_ignored", module: "reconciliation", recordType: "statement_line", recordId: lineId, reason });
  });
}

export async function workspace(actor: Actor, accountId: number, f: { from?: string; to?: string; status?: string } = {}) {
  requirePerm(actor, "recon.view");
  const lw = [sql`l.account_id = ${accountId}`];
  if (f.from) lw.push(sql`l.line_date >= ${f.from}`);
  if (f.to) lw.push(sql`l.line_date <= ${f.to}`);
  if (f.status) lw.push(sql`l.status = ${f.status}`);
  const lines = await db.execute(sql`SELECT l.*, m.account_txn_id, m.pending_payment_id, m.method, t.description AS txn_description, t.txn_date AS txn_date, t.reference AS txn_reference,
      p.payment_no AS pending_payment_no
    FROM statement_lines l
      LEFT JOIN recon_matches m ON m.statement_line_id = l.id AND m.active
      LEFT JOIN account_transactions t ON t.id = m.account_txn_id
      LEFT JOIN payments p ON p.id = m.pending_payment_id
    WHERE ${sql.join(lw, sql` AND `)} ORDER BY l.line_date, l.id`);
  const tw = [sql`t.account_id = ${accountId}`];
  if (f.from) tw.push(sql`t.txn_date >= ${f.from}`);
  if (f.to) tw.push(sql`t.txn_date <= ${f.to}`);
  const book = await db.execute(sql`SELECT t.*, EXISTS (SELECT 1 FROM recon_matches m WHERE m.active AND m.account_txn_id = t.id) AS matched
    FROM account_transactions t WHERE ${sql.join(tw, sql` AND `)} ORDER BY t.txn_date, t.id`);
  const norm = (r: Record<string, unknown>) => ({ ...r, amount: Number(r.amount) });
  const L = (lines.rows as Record<string, unknown>[]).map(norm) as (Record<string, unknown> & { amount: number; status: string })[];
  const B = (book.rows as Record<string, unknown>[]).map(norm) as (Record<string, unknown> & { amount: number; matched: boolean })[];
  return {
    lines: L, book: B,
    summary: {
      unmatchedCredits: L.filter((l) => l.status === "unmatched" && l.amount > 0),
      unmatchedDebits: L.filter((l) => l.status === "unmatched" && l.amount < 0),
      duplicates: L.filter((l) => l.status === "duplicate"),
      unmatchedBook: B.filter((b) => !b.matched),
    },
  };
}

// ───────── Reconciliation periods ─────────

export async function cashBreakdown(accountId: number, from: string, to: string) {
  const opening = await bookBalance(accountId, addDays(from, -1));
  const r = await db.execute(sql`SELECT kind, COALESCE(SUM(amount),0)::bigint AS s FROM account_transactions WHERE account_id = ${accountId} AND txn_date BETWEEN ${from} AND ${to} GROUP BY kind`);
  const by = Object.fromEntries((r.rows as { kind: string; s: string }[]).map((x) => [x.kind, Number(x.s)]));
  const collections = (by.fee_payment ?? 0) + (by.fee_payment_reversal ?? 0) + (by.other_income ?? 0) + (by.interest ?? 0);
  const deposits = (by.transfer_out ?? 0) + (by.transfer_out_reversal ?? 0);
  const receivedIn = (by.transfer_in ?? 0) + (by.transfer_in_reversal ?? 0);
  const disbursements = Object.entries(by).filter(([k]) => !["fee_payment", "fee_payment_reversal", "other_income", "interest", "transfer_out", "transfer_out_reversal", "transfer_in", "transfer_in_reversal"].includes(k)).reduce((t, [, v]) => t + v, 0);
  const closing = opening + Object.values(by).reduce((t, v) => t + v, 0);
  return { opening, collections, receivedIn, disbursements, deposits, closing, byKind: by };
}

export async function startReconciliation(actor: Actor, input: { accountId: number; periodStart: string; periodEnd: string; statementBalance: string; notes?: string }) {
  requirePerm(actor, "recon.manage");
  const ps = parseDateInput(input.periodStart), pe = parseDateInput(input.periodEnd);
  if (!ps || !pe || pe < ps) throw new ValidationError("Enter a valid period");
  const sb = parseNaira(input.statementBalance);
  if (sb === null) throw new ValidationError("Enter the statement (or counted cash) closing balance", { statementBalance: "Required" });
  return db.transaction(async (tx) => {
    const overlap = await tx.execute(sql`SELECT id FROM reconciliations WHERE account_id = ${input.accountId} AND status IN ('reconciled','in_progress','reopened')
      AND daterange(period_start, period_end, '[]') && daterange(${ps}::date, ${pe}::date, '[]')`);
    if (overlap.rows.length) throw new ConflictError("A reconciliation already exists for an overlapping period on this account.");
    const book = await bookBalance(input.accountId, pe, tx);
    const [r] = await tx.insert(reconciliations).values({ accountId: input.accountId, periodStart: ps, periodEnd: pe, statementBalance: sb, bookBalance: book, difference: sb - book,
      status: "in_progress", notes: input.notes ?? "", createdBy: actor.id }).returning();
    await audit(tx, actor, { action: "reconciliation_started", module: "reconciliation", recordType: "reconciliation", recordId: r.id, newValues: r });
    return r.id;
  });
}

export async function refreshReconciliation(actor: Actor, id: number, statementBalance?: string) {
  requirePerm(actor, "recon.manage");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reconciliations).where(eq(reconciliations.id, id)).for("update");
    if (!r) throw new NotFoundError("Reconciliation");
    if (r.status === "reconciled") throw new AppError("Reconciled periods are locked.");
    const sb = statementBalance !== undefined ? parseNaira(statementBalance) : r.statementBalance;
    if (sb === null) throw new ValidationError("Invalid balance");
    const book = await bookBalance(r.accountId, r.periodEnd, tx);
    await tx.update(reconciliations).set({ statementBalance: sb, bookBalance: book, difference: sb - book }).where(eq(reconciliations.id, id));
  });
}

export async function completeReconciliation(actor: Actor, id: number, note: string) {
  requirePerm(actor, "recon.manage");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reconciliations).where(eq(reconciliations.id, id)).for("update");
    if (!r) throw new NotFoundError("Reconciliation");
    if (r.status === "reconciled") throw new ConflictError("Already reconciled.");
    const book = await bookBalance(r.accountId, r.periodEnd, tx);
    const diff = (r.statementBalance ?? 0) - book;
    const [acc] = await tx.select().from(accounts).where(eq(accounts.id, r.accountId));
    const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM statement_lines WHERE account_id = ${r.accountId} AND status = 'unmatched' AND line_date BETWEEN ${r.periodStart} AND ${r.periodEnd}`)).rows as { n: number }[];
    if (diff !== 0) throw new AppError(`The difference is ${formatNaira(diff)}. Resolve unmatched items (record bank charges, missing entries) until the difference is ₦0.00 before locking.`);
    if (acc.type !== "cash" && n > 0 && !note.trim()) throw new AppError(`${n} statement line(s) in this period are still unmatched. Match/categorise/ignore them, or add a note explaining them.`);
    await tx.update(reconciliations).set({ status: "reconciled", bookBalance: book, difference: 0, reconciledBy: actor.id, reconciledAt: new Date(), notes: [r.notes, note].filter(Boolean).join("\n") }).where(eq(reconciliations.id, id));
    await audit(tx, actor, { action: "reconciliation_locked", module: "reconciliation", recordType: "reconciliation", recordId: id, newValues: { statementBalance: r.statementBalance, bookBalance: book }, reason: note || null });
  });
}

export async function reopenReconciliation(actor: Actor, id: number, reason: string) {
  requirePerm(actor, "recon.reopen");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a reconciled period.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reconciliations).where(eq(reconciliations.id, id)).for("update");
    if (!r) throw new NotFoundError("Reconciliation");
    if (r.status !== "reconciled") throw new AppError("Only reconciled periods can be reopened.");
    await tx.update(reconciliations).set({ status: "reopened", reopenedBy: actor.id, reopenedAt: new Date(), reopenReason: reason }).where(eq(reconciliations.id, id));
    await audit(tx, actor, { action: "reconciliation_reopened", module: "reconciliation", recordType: "reconciliation", recordId: id, oldValues: { status: "reconciled" }, newValues: { status: "reopened" }, reason });
  });
}

export async function listReconciliations(actor: Actor, accountId?: number) {
  requirePerm(actor, "recon.view");
  return db.select({ r: reconciliations, accountName: accounts.name, accountType: accounts.type, by: users.fullName }).from(reconciliations)
    .innerJoin(accounts, eq(accounts.id, reconciliations.accountId)).leftJoin(users, eq(users.id, reconciliations.reconciledBy))
    .where(accountId ? eq(reconciliations.accountId, accountId) : undefined).orderBy(desc(reconciliations.periodEnd));
}

export async function getReconciliation(actor: Actor, id: number) {
  requirePerm(actor, "recon.view");
  const [r] = await db.select().from(reconciliations).where(eq(reconciliations.id, id));
  if (!r) throw new NotFoundError("Reconciliation");
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, r.accountId));
  const ws = await workspace(actor, r.accountId, { from: r.periodStart, to: r.periodEnd });
  const cash = await cashBreakdown(r.accountId, r.periodStart, r.periodEnd);
  const liveBook = await bookBalance(r.accountId, r.periodEnd);
  const people = await db.select({ id: users.id, name: users.fullName }).from(users);
  const nm = (u: number | null) => people.find((p) => p.id === u)?.name ?? null;
  return { rec: r, account: acc, ws, cash, liveBook, createdByName: nm(r.createdBy), reconciledByName: nm(r.reconciledBy), reopenedByName: nm(r.reopenedBy) };
}

export async function listStatements(accountId?: number) {
  return db.select({ s: bankStatements, accountName: accounts.name, by: users.fullName }).from(bankStatements).innerJoin(accounts, eq(accounts.id, bankStatements.accountId))
    .innerJoin(users, eq(users.id, bankStatements.uploadedBy)).where(accountId ? eq(bankStatements.accountId, accountId) : undefined).orderBy(desc(bankStatements.uploadedAt));
}

export { asc, payments };
