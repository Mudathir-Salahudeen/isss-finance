/**
 * Analytics & reporting. Every figure is computed from posted records:
 *  - Fee collections  = APPROVED payments only (pending/rejected never count; reversals deducted on reversal date).
 *  - Cash expenses    = PAID expenses + salary payments + bank charges (from the account book).
 *  - Transfers between school accounts are excluded from income and expense.
 *  - "Accrual-style" view: fees charged (net of waivers) vs expenses approved/incurred + approved payroll cost.
 */
import { db } from "@/db";
import { sql, SQL } from "drizzle-orm";
import { Actor, can, requireAny, requirePerm } from "../actor";
import { aggregateByStudent, ageingBand, chargeBalances, BalanceFilter } from "./ledger";
import { getSettings } from "./admin";
import { accountBalances } from "./accounts";
import { todayISO, addDays } from "@/lib/dates";

const n = (v: unknown) => Number(v ?? 0);
const rows = <T = Record<string, unknown>>(r: { rows: unknown[] }) => r.rows as T[];

export interface Range { from: string; to: string }

export function previousRange(r: Range): Range {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  const to = addDays(r.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

// ───────── Cash-basis income & expenditure ─────────

/** Fee income by fee category from the account book (approved payments, minus reversals), distributed via allocations. */
async function feeIncomeByCategory(r: Range, extra: SQL = sql``) {
  return rows<{ category: string; amount: string }>(await db.execute(sql`
    SELECT fc.name AS category, SUM(CASE WHEN t.kind = 'fee_payment' THEN a.amount ELSE -a.amount END)::bigint AS amount
    FROM account_transactions t JOIN payments p ON p.id = t.source_id AND t.source_type = 'payment'
      JOIN payment_allocations a ON a.payment_id = p.id JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id JOIN fee_categories fc ON fc.id = f.category_id
    WHERE t.kind IN ('fee_payment','fee_payment_reversal') AND t.txn_date BETWEEN ${r.from} AND ${r.to} ${extra}
    GROUP BY fc.name ORDER BY 2 DESC`)).map((x) => ({ category: x.category, amount: n(x.amount) }));
}

async function bookByKind(r: Range) {
  return rows<{ kind: string; category: string | null; amount: string }>(await db.execute(sql`
    SELECT t.kind, COALESCE(ec.name, t.category_name) AS category, SUM(t.amount)::bigint AS amount
    FROM account_transactions t LEFT JOIN expenses e ON t.source_type = 'expense' AND e.id = t.source_id LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE t.txn_date BETWEEN ${r.from} AND ${r.to} AND t.kind NOT IN ('transfer_in','transfer_out','transfer_in_reversal','transfer_out_reversal','fee_payment','fee_payment_reversal')
    GROUP BY t.kind, COALESCE(ec.name, t.category_name)`)).map((x) => ({ ...x, amount: n(x.amount) }));
}

export async function cashIncomeExpenditure(r: Range) {
  const fee = await feeIncomeByCategory(r);
  const book = await bookByKind(r);
  const otherIncome = book.filter((b) => ["other_income", "interest"].includes(b.kind)).map((b) => ({ category: b.category ?? (b.kind === "interest" ? "Interest received" : "Other income"), amount: b.amount }));
  const expenseRows = book.filter((b) => ["expense", "expense_reversal", "salary", "salary_reversal", "bank_charge", "other_expense", "refund"].includes(b.kind));
  const expMap = new Map<string, number>();
  for (const e of expenseRows) {
    const cat = e.kind.startsWith("salary") ? "Salaries (payroll)" : e.category ?? (e.kind === "bank_charge" ? "Bank charges" : "Other");
    expMap.set(cat, (expMap.get(cat) ?? 0) - e.amount); // book amounts are negative for outflows
  }
  const expenses = [...expMap.entries()].map(([category, amount]) => ({ category, amount })).filter((x) => x.amount !== 0).sort((a, b) => b.amount - a.amount);
  const income = [...fee.map((f) => ({ ...f, group: "Fees" })), ...otherIncome.map((o) => ({ ...o, group: "Other income" }))];
  const totalIncome = income.reduce((t, x) => t + x.amount, 0);
  const totalExpenses = expenses.reduce((t, x) => t + x.amount, 0);
  const payroll = expMap.get("Salaries (payroll)") ?? 0;
  return { basis: "cash" as const, range: r, income, expenses, totalIncome, totalExpenses, payroll, surplus: totalIncome - totalExpenses,
    marginTenths: totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) * 1000) / totalIncome) : null };
}

/** Accrual-style: fees charged in the period (by charge creation date, net of adjustments) vs costs incurred/approved. */
export async function accrualIncomeExpenditure(r: Range) {
  const income = rows<{ category: string; amount: string }>(await db.execute(sql`
    SELECT fc.name AS category, SUM(c.amount + COALESCE((SELECT SUM(a.amount) FROM fee_adjustments a WHERE a.charge_id = c.id AND a.reversed_at IS NULL),0))::bigint AS amount
    FROM fee_charges c JOIN fees f ON f.id = c.fee_id JOIN fee_categories fc ON fc.id = f.category_id
    WHERE c.status = 'active' AND f.is_system = false AND c.created_at::date BETWEEN ${r.from} AND ${r.to} GROUP BY fc.name ORDER BY 2 DESC`)).map((x) => ({ category: x.category, amount: n(x.amount), group: "Fees charged" }));
  const exp = rows<{ category: string; amount: string }>(await db.execute(sql`
    SELECT ec.name AS category, SUM(e.amount)::bigint AS amount FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.status IN ('approved','paid') AND e.date_incurred BETWEEN ${r.from} AND ${r.to} GROUP BY ec.name`)).map((x) => ({ category: x.category, amount: n(x.amount) }));
  const pay = rows<{ amount: string }>(await db.execute(sql`SELECT COALESCE(SUM(l.gross),0)::bigint AS amount FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id
    WHERE p.status IN ('approved','partially_paid','paid') AND (p.period || '-01')::date BETWEEN date_trunc('month', ${r.from}::date) AND ${r.to}::date`))[0];
  const other = rows<{ kind: string; amount: string }>(await db.execute(sql`SELECT kind, SUM(amount)::bigint AS amount FROM account_transactions WHERE kind IN ('bank_charge','other_expense','interest','other_income') AND txn_date BETWEEN ${r.from} AND ${r.to} GROUP BY kind`));
  const expenses = [...exp];
  if (n(pay.amount)) expenses.push({ category: "Salaries (payroll, approved)", amount: n(pay.amount) });
  const bc = -other.filter((o) => ["bank_charge", "other_expense"].includes(o.kind)).reduce((t, o) => t + n(o.amount), 0);
  if (bc) expenses.push({ category: "Bank charges / other", amount: bc });
  const oi = other.filter((o) => ["interest", "other_income"].includes(o.kind)).reduce((t, o) => t + n(o.amount), 0);
  if (oi) income.push({ category: "Interest / other income", amount: oi, group: "Other income" });
  expenses.sort((a, b) => b.amount - a.amount);
  const totalIncome = income.reduce((t, x) => t + x.amount, 0), totalExpenses = expenses.reduce((t, x) => t + x.amount, 0);
  return { basis: "accrual" as const, range: r, income, expenses, totalIncome, totalExpenses, payroll: n(pay.amount), surplus: totalIncome - totalExpenses,
    marginTenths: totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) * 1000) / totalIncome) : null };
}

export async function profitAndLoss(actor: Actor, r: Range) {
  requirePerm(actor, "reports.financial");
  const [cash, accrual, prevCash] = await Promise.all([cashIncomeExpenditure(r), accrualIncomeExpenditure(r), cashIncomeExpenditure(previousRange(r))]);
  const debt = await outstandingTotals({});
  const unpaid = await unpaidLiabilities();
  return { cash, accrual, prevCash, outstandingFees: debt.outstanding, unpaid };
}

export async function unpaidLiabilities() {
  const e = rows<{ n: number; s: string }>(await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS s FROM expenses WHERE status = 'approved'`))[0];
  const p = rows<{ s: string }>(await db.execute(sql`SELECT COALESCE(SUM(l.net - l.paid_amount),0)::bigint AS s FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id WHERE p.status IN ('approved','partially_paid')`))[0];
  return { approvedUnpaidExpenses: n(e.s), approvedUnpaidCount: e.n, unpaidSalaries: n(p.s) };
}

export async function outstandingTotals(f: BalanceFilter) {
  const b = await chargeBalances(f);
  return {
    expected: b.reduce((t, x) => t + x.net, 0), paid: b.reduce((t, x) => t + x.paid, 0), pending: b.reduce((t, x) => t + x.pending, 0),
    outstanding: b.reduce((t, x) => t + Math.max(x.outstanding, 0), 0), credit: b.reduce((t, x) => t + Math.min(x.outstanding, 0), 0), charges: b,
  };
}

// ───────── Monthly trends ─────────

export async function monthlyTrend(months = 12, end = todayISO()) {
  const startMonth = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - months, 1)).toISOString().slice(0, 10);
  const r = rows<{ m: string; income: string; fees: string; expense: string }>(await db.execute(sql`
    WITH m AS (SELECT generate_series(${startMonth}::date, date_trunc('month', ${end}::date), interval '1 month')::date AS m)
    SELECT to_char(m.m, 'YYYY-MM') AS m,
      COALESCE((SELECT SUM(amount) FROM account_transactions t WHERE date_trunc('month', t.txn_date) = m.m AND t.kind IN ('fee_payment','fee_payment_reversal','other_income','interest')),0)::bigint AS income,
      COALESCE((SELECT SUM(amount) FROM account_transactions t WHERE date_trunc('month', t.txn_date) = m.m AND t.kind IN ('fee_payment','fee_payment_reversal')),0)::bigint AS fees,
      COALESCE((SELECT -SUM(amount) FROM account_transactions t WHERE date_trunc('month', t.txn_date) = m.m AND t.kind IN ('expense','expense_reversal','salary','salary_reversal','bank_charge','other_expense','refund')),0)::bigint AS expense
    FROM m ORDER BY m.m`));
  return r.map((x) => ({ month: x.m, income: n(x.income), fees: n(x.fees), expense: n(x.expense), surplus: n(x.income) - n(x.expense) }));
}

// ───────── Revenue & expense analysis ─────────

export async function revenueAnalysis(actor: Actor, r: Range, f: { sessionId?: number; termId?: number } = {}) {
  requirePerm(actor, "reports.financial");
  const sf = [sql`p.status = 'approved'`, sql`p.payment_date BETWEEN ${r.from} AND ${r.to}`];
  if (f.sessionId) sf.push(sql`c.session_id = ${f.sessionId}`);
  if (f.termId) sf.push(sql`c.term_id = ${f.termId}`);
  const W = sql.join(sf, sql` AND `);
  const q = (dim: SQL, join: SQL = sql``) => db.execute(sql`SELECT ${dim} AS k, SUM(a.amount)::bigint AS amount, count(DISTINCT p.id)::int AS payments
    FROM payments p JOIN payment_allocations a ON a.payment_id = p.id JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id JOIN fee_categories fc ON fc.id = f.category_id
      LEFT JOIN classes cl ON cl.id = c.class_id LEFT JOIN terms t ON t.id = c.term_id JOIN academic_sessions ses ON ses.id = c.session_id
      JOIN payment_channels ch ON ch.id = p.channel_id JOIN accounts ac ON ac.id = p.account_id ${join}
    WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`).then((x) => rows<{ k: string; amount: string; payments: number }>(x).map((y) => ({ key: y.k ?? "—", amount: n(y.amount), payments: y.payments })));
  const [byCategory, byFee, byClass, byTerm, byChannel, byAccount] = await Promise.all([
    q(sql`fc.name`), q(sql`f.name || ' (' || ses.name || COALESCE(' ' || t.name, '') || ')'`), q(sql`cl.name`), q(sql`ses.name || COALESCE(' — ' || t.name, '')`), q(sql`ch.name`), q(sql`ac.name`),
  ]);
  const prev = previousRange(r);
  const prevCat = await db.execute(sql`SELECT fc.name AS k, SUM(a.amount)::bigint AS amount FROM payments p JOIN payment_allocations a ON a.payment_id = p.id JOIN fee_charges c ON c.id = a.charge_id
    JOIN fees f ON f.id = c.fee_id JOIN fee_categories fc ON fc.id = f.category_id WHERE p.status = 'approved' AND p.payment_date BETWEEN ${prev.from} AND ${prev.to} GROUP BY 1`)
    .then((x) => rows<{ k: string; amount: string }>(x).map((y) => ({ key: y.k, amount: n(y.amount) })));
  const exp = await outstandingTotals({ sessionId: f.sessionId, termId: f.termId });
  const perFee = new Map<string, { expected: number; paid: number; outstanding: number }>();
  for (const c of exp.charges) {
    const k = c.categoryName;
    const v = perFee.get(k) ?? { expected: 0, paid: 0, outstanding: 0 };
    v.expected += c.net; v.paid += c.paid; v.outstanding += Math.max(c.outstanding, 0);
    perFee.set(k, v);
  }
  return { range: r, prev, byCategory, byFee, byClass, byTerm, byChannel, byAccount, prevByCategory: prevCat,
    expectedByCategory: [...perFee.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.expected - a.expected), totals: { expected: exp.expected, paid: exp.paid, outstanding: exp.outstanding } };
}

export async function expenseAnalysis(actor: Actor, r: Range) {
  requireAny(actor, "reports.financial", "expenses.view");
  const base = sql`e.status IN ('paid') AND e.paid_date BETWEEN ${r.from} AND ${r.to}`;
  const q = (dim: SQL, where: SQL = base) => db.execute(sql`SELECT ${dim} AS k, SUM(e.amount)::bigint AS amount, count(*)::int AS cnt
    FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN accounts a ON a.id = e.paid_account_id
      JOIN users u ON u.id = e.created_by
    WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`).then((x) => rows<{ k: string; amount: string; cnt: number }>(x).map((y) => ({ key: y.k ?? "—", amount: n(y.amount), count: y.cnt })));
  const [byCategory, byVendor, byDepartment, byAccount, byMonth, byEnteredBy] = await Promise.all([
    q(sql`ec.name`), q(sql`COALESCE(v.name, e.payee_name)`), q(sql`NULLIF(e.department, '')`), q(sql`a.name`), q(sql`to_char(e.paid_date, 'YYYY-MM')`), q(sql`u.full_name`),
  ]);
  const prev = previousRange(r);
  const prevByCategory = await q(sql`ec.name`, sql`e.status = 'paid' AND e.paid_date BETWEEN ${prev.from} AND ${prev.to}`);
  const statusTotals = rows<{ status: string; amount: string; cnt: number }>(await db.execute(sql`SELECT status, SUM(amount)::bigint AS amount, count(*)::int AS cnt FROM expenses
    WHERE date_incurred BETWEEN ${r.from} AND ${r.to} GROUP BY status`)).map((x) => ({ status: x.status, amount: n(x.amount), count: x.cnt }));
  const recurring = rows<Record<string, unknown>>(await db.execute(sql`SELECT DISTINCT ON (lower(e.title)) e.id, e.title, e.recurrence, e.amount, e.date_incurred, ec.name AS category, e.status
    FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id WHERE e.recurring AND e.status NOT IN ('cancelled','rejected') ORDER BY lower(e.title), e.date_incurred DESC`));
  return { range: r, prev, byCategory, byVendor, byDepartment, byAccount, byMonth, byEnteredBy, prevByCategory, statusTotals,
    recurring: recurring.map((x) => ({ ...x, amount: n(x.amount), nextDue: nextDue(String(x.date_incurred).slice(0, 10), String(x.recurrence)) }) as Record<string, unknown> & { amount: number; nextDue: string }) };
}

function nextDue(last: string, recurrence: string) {
  const add = { weekly: 7, monthly: 30, termly: 91, quarterly: 91, yearly: 365, annually: 365 }[recurrence.toLowerCase()] ?? 30;
  if (recurrence.toLowerCase() === "monthly") { const d = new Date(last); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); }
  return addDays(last, add);
}

// ───────── Debtors & fee collection ─────────

export interface DebtorFilter extends BalanceFilter { status?: string; min?: number; max?: number; overdueOnly?: boolean; band?: string; q?: string; dueFrom?: string; dueTo?: string; includeInactive?: boolean }

export async function debtors(actor: Actor, f: DebtorFilter) {
  requirePerm(actor, "debtors.view");
  const s = await getSettings();
  let charges = await chargeBalances(f);
  if (f.dueFrom) charges = charges.filter((c) => c.dueDate && c.dueDate >= f.dueFrom!);
  if (f.dueTo) charges = charges.filter((c) => c.dueDate && c.dueDate <= f.dueTo!);
  const today = todayISO();
  let list = aggregateByStudent(charges, today).map((x) => ({ ...x, ageing: ageingBand(x.oldestOverdueDays, s.ageingBands), overdue: x.overdueAmount > 0 }));
  if (!f.includeInactive) list = list.filter((x) => !["withdrawn", "transferred", "graduated", "archived"].includes(x.studentStatus) || x.outstanding > 0);
  if (f.status) list = list.filter((x) => (f.status === "no_payment" ? x.paid === 0 && x.outstanding > 0 : f.status === "owing" ? x.outstanding > 0 : x.status === f.status));
  else list = list.filter((x) => x.outstanding > 0);
  if (f.min !== undefined) list = list.filter((x) => x.outstanding >= f.min!);
  if (f.max !== undefined) list = list.filter((x) => x.outstanding <= f.max!);
  if (f.overdueOnly) list = list.filter((x) => x.overdue);
  if (f.band) list = list.filter((x) => x.ageing === f.band);
  if (f.q) { const q = f.q.toLowerCase(); list = list.filter((x) => x.studentName.toLowerCase().includes(q) || x.admissionNo.toLowerCase().includes(q)); }
  list.sort((a, b) => b.outstanding - a.outstanding);
  const byClass = new Map<string, { className: string; levelOrder: number; outstanding: number; students: number }>();
  for (const d of list) {
    const k = d.className ?? "—";
    const v = byClass.get(k) ?? { className: k, levelOrder: d.levelOrder ?? 999, outstanding: 0, students: 0 };
    v.outstanding += d.outstanding; v.students++;
    byClass.set(k, v);
  }
  return { list, byClass: [...byClass.values()].sort((a, b) => a.levelOrder - b.levelOrder), bands: s.ageingBands,
    totals: { students: list.length, net: list.reduce((t, x) => t + x.net, 0), paid: list.reduce((t, x) => t + x.paid, 0), pending: list.reduce((t, x) => t + x.pending, 0), outstanding: list.reduce((t, x) => t + x.outstanding, 0), overdue: list.reduce((t, x) => t + x.overdueAmount, 0) } };
}

export async function feeCollectionReport(actor: Actor, f: { sessionId?: number; termId?: number; categoryId?: number; feeId?: number; classId?: number }) {
  requireAny(actor, "fees.view", "reports.view");
  const charges = await chargeBalances(f);
  const m = new Map<number, { feeId: number; feeName: string; categoryName: string; sessionName: string; termName: string | null; students: number; expected: number; paid: number; pending: number; outstanding: number; debtors: number; fullyPaid: number }>();
  for (const c of charges) {
    const v = m.get(c.feeId) ?? { feeId: c.feeId, feeName: c.feeName, categoryName: c.categoryName, sessionName: c.sessionName, termName: c.termName, students: 0, expected: 0, paid: 0, pending: 0, outstanding: 0, debtors: 0, fullyPaid: 0 };
    v.students++; v.expected += c.net; v.paid += c.paid; v.pending += c.pending; v.outstanding += Math.max(c.outstanding, 0);
    if (c.outstanding > 0) v.debtors++; else v.fullyPaid++;
    m.set(c.feeId, v);
  }
  const list = [...m.values()].map((v) => ({ ...v, rateTenths: v.expected ? Math.round((v.paid * 1000) / v.expected) : 0 }));
  return { list, totals: list.reduce((t, x) => ({ expected: t.expected + x.expected, paid: t.paid + x.paid, pending: t.pending + x.pending, outstanding: t.outstanding + x.outstanding }), { expected: 0, paid: 0, pending: 0, outstanding: 0 }) };
}

// ───────── Director dashboard ─────────

export async function directorDashboard(actor: Actor, f: { range: Range; sessionId?: number; termId?: number; classId?: number; accountId?: number }) {
  requirePerm(actor, "dashboard.view");
  const isDirector = can(actor, "dashboard.director");
  const r = f.range, prev = previousRange(r);
  const acctCond = f.accountId ? sql`AND p.account_id = ${f.accountId}` : sql``;
  const classCond = f.classId ? sql`AND c.class_id = ${f.classId}` : sql``;
  const sesCond = f.sessionId ? sql`AND c.session_id = ${f.sessionId}` : sql``;
  const termCond = f.termId ? sql`AND c.term_id = ${f.termId}` : sql``;
  const collected = async (rg: Range) => n(rows<{ s: string }>(await db.execute(sql`SELECT COALESCE(SUM(a.amount),0)::bigint AS s FROM payments p
    JOIN payment_allocations a ON a.payment_id = p.id JOIN fee_charges c ON c.id = a.charge_id
    WHERE p.status = 'approved' AND p.payment_date BETWEEN ${rg.from} AND ${rg.to} ${acctCond} ${classCond} ${sesCond} ${termCond}`))[0].s);
  const [collections, prevCollections] = await Promise.all([collected(r), collected(prev)]);
  const fees = await outstandingTotals({ sessionId: f.sessionId, termId: f.termId, classId: f.classId });
  const pending = rows<{ n: number; s: string }>(await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS s FROM payments WHERE status = 'pending'`))[0];
  const pendingLarge = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM payments WHERE status = 'pending' AND (is_large OR possible_duplicate_of IS NOT NULL)`))[0];
  const expPending = rows<{ dir: boolean; n: number; s: string }>(await db.execute(sql`SELECT r.is_system AS dir, count(*)::int AS n, COALESCE(SUM(e.amount),0)::bigint AS s FROM expenses e
    JOIN users u ON u.id = e.created_by JOIN roles r ON r.id = u.role_id WHERE e.status = 'pending' GROUP BY r.is_system`));
  const expEntered = rows<{ dir: boolean; n: number; s: string }>(await db.execute(sql`SELECT r.is_system AS dir, count(*)::int AS n, COALESCE(SUM(e.amount),0)::bigint AS s FROM expenses e
    JOIN users u ON u.id = e.created_by JOIN roles r ON r.id = u.role_id WHERE e.date_incurred BETWEEN ${r.from} AND ${r.to} AND e.status NOT IN ('cancelled','rejected','draft') GROUP BY r.is_system`));
  const [cash, prevCash] = await Promise.all([cashIncomeExpenditure(r), cashIncomeExpenditure(prev)]);
  const unpaid = await unpaidLiabilities();
  const balances = can(actor, "accounts.view") ? await accountBalances() : [];
  const unmatched = rows<{ n: number; s: string }>(await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(abs(amount)),0)::bigint AS s FROM statement_lines WHERE status IN ('unmatched','duplicate')`))[0];
  let payroll = null;
  if (can(actor, "payroll.view")) {
    const month = todayISO().slice(0, 7);
    const cur = rows<Record<string, unknown>>(await db.execute(sql`SELECT p.id, p.period, p.status, COALESCE(SUM(l.gross),0)::bigint AS gross, COALESCE(SUM(l.net),0)::bigint AS net, COALESCE(SUM(l.paid_amount),0)::bigint AS paid
      FROM payroll_periods p LEFT JOIN payroll_lines l ON l.period_id = p.id WHERE p.period = ${month} AND p.status <> 'cancelled' GROUP BY p.id`))[0];
    const arrears = rows<{ s: string }>(await db.execute(sql`SELECT COALESCE(SUM(l.net - l.paid_amount),0)::bigint AS s FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id
      WHERE p.status IN ('approved','partially_paid') AND p.period < ${month}`))[0];
    const paidInRange = -n(rows<{ s: string }>(await db.execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM account_transactions WHERE kind IN ('salary','salary_reversal') AND txn_date BETWEEN ${r.from} AND ${r.to}`))[0].s);
    const est = rows<{ s: string; c: number }>(await db.execute(sql`SELECT COALESCE(SUM(b.basic + COALESCE(i.al,0) ),0)::bigint AS s, count(*)::int AS c FROM staff s
      JOIN LATERAL (SELECT basic FROM salary_history h WHERE h.staff_id = s.id AND h.effective_from <= CURRENT_DATE ORDER BY effective_from DESC, id DESC LIMIT 1) b ON true
      LEFT JOIN LATERAL (SELECT SUM(amount) AS al FROM staff_pay_items i WHERE i.staff_id = s.id AND i.active AND i.kind = 'allowance') i ON true WHERE s.status IN ('active','on_leave')`))[0];
    payroll = { currentPeriod: cur ? { id: cur.id as number, period: String(cur.period), status: String(cur.status), gross: n(cur.gross), net: n(cur.net), paid: n(cur.paid) } : null, arrears: n(arrears.s), paidInRange, upcomingEstimate: n(est.s), activeStaff: est.c, month };
  }
  const debt = await debtors({ ...actor, permissions: new Set([...actor.permissions, "debtors.view"]) }, { sessionId: f.sessionId, termId: f.termId, classId: f.classId });
  const recent = rows<Record<string, unknown>>(await db.execute(sql`SELECT at, user_name, action, module, record_type, record_id FROM audit_events
    WHERE module IN ('payments','expenses','payroll','reconciliation','fees','accounts') ORDER BY at DESC LIMIT 12`));
  const trend = await monthlyTrend(6, r.to);
  return {
    isDirector, range: r, prev,
    collections, prevCollections,
    fees: { expected: fees.expected, paid: fees.paid, pending: fees.pending, outstanding: fees.outstanding, rateTenths: fees.expected ? Math.round((fees.paid * 1000) / fees.expected) : 0 },
    pending: { count: pending.n, total: n(pending.s), flagged: pendingLarge.n },
    expenses: {
      paidInRange: cash.totalExpenses - cash.payroll, approvedUnpaid: unpaid.approvedUnpaidExpenses, approvedUnpaidCount: unpaid.approvedUnpaidCount,
      pendingDirector: expPending.filter((x) => x.dir).reduce((t, x) => ({ n: t.n + x.n, s: t.s + n(x.s) }), { n: 0, s: 0 }),
      pendingOthers: expPending.filter((x) => !x.dir).reduce((t, x) => ({ n: t.n + x.n, s: t.s + n(x.s) }), { n: 0, s: 0 }),
      enteredDirector: expEntered.filter((x) => x.dir).reduce((t, x) => ({ n: t.n + x.n, s: t.s + n(x.s) }), { n: 0, s: 0 }),
      enteredOthers: expEntered.filter((x) => !x.dir).reduce((t, x) => ({ n: t.n + x.n, s: t.s + n(x.s) }), { n: 0, s: 0 }),
    },
    cash, prevCash, unpaid, balances, unmatched: { count: unmatched.n, total: n(unmatched.s) }, payroll,
    debtorsByClass: debt.byClass, topDebtors: debt.list.slice(0, 10), debtorTotals: debt.totals,
    recent, trend,
  };
}

export { addDays };
