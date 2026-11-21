/**
 * Payroll. Period: Draft → Pending approval → Approved → Partially paid → Paid  (Pending → Rejected → editable again).
 * Payroll cost is recognised from APPROVED payroll lines; cash outflow from salary PAYMENTS. Payroll never creates
 * expense records, so it is never double-counted with Expenses.
 * Statutory deductions (PAYE, pension, NHF, etc.) are NOT hard-coded: configure them per staff as deduction items.
 */
import { db, DBorTx } from "@/db";
import { staff, salaryHistory, staffPayItems, staffLoans, payrollPeriods, payrollLines, payrollLineItems, salaryPayments, workflowHistory, users } from "@/db/schema";
import { and, asc, desc, eq, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { Actor, requirePerm } from "../actor";
import { audit, notify, usersWithPermission } from "../audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatNaira, parseNaira } from "@/lib/money";
import { parseDateInput, todayISO } from "@/lib/dates";
import { assertAccountAccess, postTxn } from "./accounts";
import { getSettings } from "./admin";

// ───────── Staff ─────────

export const staffSchema = z.object({
  staffNo: z.string().trim().min(1, "Staff ID is required").max(30),
  fullName: z.string().trim().min(2, "Name is required"),
  department: z.string().trim().default(""),
  position: z.string().trim().default(""),
  status: z.enum(["active", "on_leave", "suspended", "exited"]).default("active"),
  startDate: z.string().optional().nullable(),
  salaryType: z.enum(["monthly", "daily", "contract"]).default("monthly"),
  bankName: z.string().trim().default(""),
  bankAccountNumber: z.string().trim().default("").refine((v) => !v || /^\d{10}$/.test(v), "NUBAN account numbers are 10 digits"),
  bankAccountName: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  email: z.string().trim().default(""),
});

export async function listStaff(actor: Actor) {
  requirePerm(actor, "payroll.view");
  const res = await db.execute(sql`SELECT s.*, (SELECT h.basic FROM salary_history h WHERE h.staff_id = s.id AND h.effective_from <= CURRENT_DATE ORDER BY h.effective_from DESC, h.id DESC LIMIT 1)::bigint AS basic,
      (SELECT COALESCE(SUM(amount),0) FROM staff_pay_items i WHERE i.staff_id = s.id AND i.active AND i.kind = 'allowance')::bigint AS allowances,
      (SELECT COALESCE(SUM(amount),0) FROM staff_pay_items i WHERE i.staff_id = s.id AND i.active AND i.kind = 'deduction')::bigint AS deductions,
      (SELECT COALESCE(SUM(balance),0) FROM staff_loans l WHERE l.staff_id = s.id AND l.status = 'active')::bigint AS loan_balance
    FROM staff s ORDER BY s.full_name`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as number, staffNo: r.staff_no as string, fullName: r.full_name as string, department: r.department as string, position: r.position as string, status: r.status as string,
    startDate: r.start_date ? String(r.start_date).slice(0, 10) : null, salaryType: r.salary_type as string, bankName: r.bank_name as string, bankAccountNumber: r.bank_account_number as string,
    basic: r.basic === null ? null : Number(r.basic), allowances: Number(r.allowances), deductions: Number(r.deductions), loanBalance: Number(r.loan_balance),
  }));
}

export async function getStaff(actor: Actor, id: number) {
  requirePerm(actor, "payroll.view");
  const [s] = await db.select().from(staff).where(eq(staff.id, id));
  if (!s) throw new NotFoundError("Staff member");
  const hist = await db.select({ h: salaryHistory, by: users.fullName }).from(salaryHistory).innerJoin(users, eq(users.id, salaryHistory.createdBy)).where(eq(salaryHistory.staffId, id)).orderBy(desc(salaryHistory.effectiveFrom), desc(salaryHistory.id));
  const items = await db.select().from(staffPayItems).where(eq(staffPayItems.staffId, id)).orderBy(asc(staffPayItems.kind), asc(staffPayItems.name));
  const loans = await db.select().from(staffLoans).where(eq(staffLoans.staffId, id)).orderBy(desc(staffLoans.createdAt));
  const lines = await db.execute(sql`SELECT l.*, p.period, p.status AS period_status FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id WHERE l.staff_id = ${id} ORDER BY p.period DESC`);
  return { staff: s, salaryHistory: hist.map((x) => ({ ...x.h, byName: x.by })), items, loans, lines: lines.rows as Record<string, unknown>[] };
}

export async function saveStaff(actor: Actor, id: number | null, input: z.input<typeof staffSchema> & { basic?: string; effectiveFrom?: string; reason?: string }, tx0?: DBorTx) {
  requirePerm(actor, "payroll.manage_staff");
  const d = staffSchema.parse(input);
  const startDate = d.startDate ? parseDateInput(d.startDate) : null;
  const run = async (tx: DBorTx) => {
    const dup = await tx.select().from(staff).where(eq(staff.staffNo, d.staffNo));
    if (dup.length && dup[0].id !== id) throw new ConflictError(`Staff ID ${d.staffNo} already exists.`);
    let old = null;
    if (id) {
      [old] = await tx.select().from(staff).where(eq(staff.id, id));
      if (!old) throw new NotFoundError("Staff member");
      await tx.update(staff).set({ ...d, startDate }).where(eq(staff.id, id));
    } else {
      id = (await tx.insert(staff).values({ ...d, startDate }).returning())[0].id;
      if (input.basic) {
        const b = parseNaira(input.basic);
        if (b === null || b < 0) throw new ValidationError("Invalid basic salary", { basic: "Invalid amount" });
        await tx.insert(salaryHistory).values({ staffId: id, basic: b, effectiveFrom: parseDateInput(input.effectiveFrom) ?? startDate ?? todayISO(), reason: input.reason || "Initial salary", createdBy: actor.id });
      }
    }
    await audit(tx, actor, { action: old ? "staff_updated" : "staff_created", module: "payroll", recordType: "staff", recordId: id, oldValues: old ? { ...old, bankAccountNumber: "•••" } : undefined, newValues: { ...d, bankAccountNumber: "•••" } });
    return id;
  };
  return tx0 ? run(tx0) : db.transaction(run);
}

export async function setSalary(actor: Actor, staffId: number, basicInput: string, effectiveFrom: string, reason: string) {
  requirePerm(actor, "payroll.manage_staff");
  const basic = parseNaira(basicInput);
  if (basic === null || basic < 0) throw new ValidationError("Invalid amount", { basic: "Invalid amount" });
  const eff = parseDateInput(effectiveFrom);
  if (!eff) throw new ValidationError("Invalid effective date");
  if (!reason?.trim()) throw new ValidationError("A reason for the salary change is required", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(salaryHistory).where(and(eq(salaryHistory.staffId, staffId), lte(salaryHistory.effectiveFrom, eff))).orderBy(desc(salaryHistory.effectiveFrom), desc(salaryHistory.id)).limit(1);
    const [h] = await tx.insert(salaryHistory).values({ staffId, basic, effectiveFrom: eff, reason, createdBy: actor.id }).returning();
    await audit(tx, actor, { action: "salary_changed", module: "payroll", recordType: "staff", recordId: staffId, oldValues: prev ? { basic: prev.basic } : null, newValues: { basic, effectiveFrom: eff }, reason });
    return h.id;
  });
}

export async function savePayItem(actor: Actor, id: number | null, staffId: number, input: { kind: "allowance" | "deduction"; name: string; amount: string; active: boolean }) {
  requirePerm(actor, "payroll.manage_staff");
  const amount = parseNaira(input.amount);
  if (amount === null || amount < 0) throw new ValidationError("Invalid amount");
  if (!input.name.trim()) throw new ValidationError("Item name is required");
  return db.transaction(async (tx) => {
    const values = { staffId, kind: input.kind, name: input.name.trim(), amount, active: input.active, createdBy: actor.id };
    if (id) await tx.update(staffPayItems).set(values).where(eq(staffPayItems.id, id));
    else id = (await tx.insert(staffPayItems).values(values).returning())[0].id;
    await audit(tx, actor, { action: "pay_item_saved", module: "payroll", recordType: "staff", recordId: staffId, newValues: values });
    return id;
  });
}

export async function addLoan(actor: Actor, staffId: number, input: { kind: "loan" | "advance"; principal: string; monthlyDeduction: string; reason: string }) {
  requirePerm(actor, "payroll.manage_staff");
  const principal = parseNaira(input.principal), monthly = parseNaira(input.monthlyDeduction);
  if (!principal || principal <= 0 || !monthly || monthly <= 0) throw new ValidationError("Enter valid amounts");
  if (monthly > principal) throw new ValidationError("Monthly deduction cannot exceed the principal");
  return db.transaction(async (tx) => {
    const [l] = await tx.insert(staffLoans).values({ staffId, kind: input.kind, principal, monthlyDeduction: monthly, balance: principal, reason: input.reason, createdBy: actor.id }).returning();
    await audit(tx, actor, { action: "staff_loan_created", module: "payroll", recordType: "staff_loan", recordId: l.id, newValues: l });
    return l.id;
  });
}

// ───────── Payroll periods ─────────

async function hist(tx: DBorTx, actor: Actor, id: number, action: string, from: string | null, to: string, comment?: string | null) {
  await tx.insert(workflowHistory).values({ entityType: "payroll", entityId: id, action, fromStatus: from, toStatus: to, actorId: actor.id, comment: comment ?? null });
}

function recompute(l: { basic: number; allowances: number; bonus: number; arrears: number; deductions: number; loanDeduction: number }) {
  const gross = l.basic + l.allowances + l.bonus + l.arrears;
  return { gross, net: gross - l.deductions - l.loanDeduction };
}

export async function generatePayroll(actor: Actor, period: string, payDate?: string) {
  requirePerm(actor, "payroll.prepare");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError("Period must be YYYY-MM", { period: "Format YYYY-MM" });
  const periodEnd = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).toISOString().slice(0, 10);
  return db.transaction(async (tx) => {
    const ex = await tx.select().from(payrollPeriods).where(and(eq(payrollPeriods.period, period), sql`${payrollPeriods.status} <> 'cancelled'`));
    if (ex.length) throw new ConflictError(`Payroll for ${period} already exists.`);
    const name = new Date(`${period}-01T00:00:00Z`).toLocaleString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" }) + " Payroll";
    const [p] = await tx.insert(payrollPeriods).values({ period, name, payDate: parseDateInput(payDate) ?? periodEnd, createdBy: actor.id }).returning();
    const people = await tx.select().from(staff).where(inArray(staff.status, ["active", "on_leave"]));
    let count = 0;
    for (const s of people) {
      const [sal] = await tx.select().from(salaryHistory).where(and(eq(salaryHistory.staffId, s.id), lte(salaryHistory.effectiveFrom, periodEnd))).orderBy(desc(salaryHistory.effectiveFrom), desc(salaryHistory.id)).limit(1);
      if (!sal) continue;
      const items = await tx.select().from(staffPayItems).where(and(eq(staffPayItems.staffId, s.id), eq(staffPayItems.active, true)));
      const loans = await tx.select().from(staffLoans).where(and(eq(staffLoans.staffId, s.id), eq(staffLoans.status, "active")));
      const allowances = items.filter((i) => i.kind === "allowance").reduce((t, i) => t + i.amount, 0);
      const deductions = items.filter((i) => i.kind === "deduction").reduce((t, i) => t + i.amount, 0);
      const loanParts = loans.map((l) => ({ l, amt: Math.min(l.monthlyDeduction, l.balance) }));
      const loanDeduction = loanParts.reduce((t, x) => t + x.amt, 0);
      const base = { basic: sal.basic, allowances, bonus: 0, arrears: 0, deductions, loanDeduction };
      const [line] = await tx.insert(payrollLines).values({ periodId: p.id, staffId: s.id, ...base, ...recompute(base) }).returning();
      const li = [
        ...items.map((i) => ({ lineId: line.id, kind: i.kind, name: i.name, amount: i.amount })),
        ...loanParts.filter((x) => x.amt > 0).map((x) => ({ lineId: line.id, kind: "loan", name: `${x.l.kind === "loan" ? "Loan" : "Advance"} repayment`, amount: x.amt, loanId: x.l.id })),
      ];
      if (li.length) await tx.insert(payrollLineItems).values(li);
      count++;
    }
    await hist(tx, actor, p.id, "generated", null, "draft", `${count} staff`);
    await audit(tx, actor, { action: "payroll_generated", module: "payroll", recordType: "payroll_period", recordId: p.id, newValues: { period, staff: count } });
    return p.id;
  });
}

async function editablePeriod(tx: DBorTx, periodId: number) {
  const [p] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
  if (!p) throw new NotFoundError("Payroll period");
  if (!["draft", "rejected"].includes(p.status)) throw new AppError("Approved or submitted payroll cannot be edited. Past approved payroll is preserved as-is.");
  return p;
}

async function recalcLine(tx: DBorTx, lineId: number) {
  const [l] = await tx.select().from(payrollLines).where(eq(payrollLines.id, lineId));
  const items = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.lineId, lineId));
  const sum = (k: string) => items.filter((i) => i.kind === k).reduce((t, i) => t + i.amount, 0);
  const base = { basic: l.basic, allowances: sum("allowance"), bonus: sum("bonus"), arrears: sum("arrears"), deductions: sum("deduction"), loanDeduction: sum("loan") };
  const c = recompute(base);
  if (c.net < 0) throw new ValidationError("Deductions cannot exceed gross pay.");
  await tx.update(payrollLines).set({ ...base, ...c }).where(eq(payrollLines.id, lineId));
}

/** Add a bonus, arrears, allowance or deduction to one staff member's line (draft/rejected payroll only). */
export async function addLineItem(actor: Actor, lineId: number, input: { kind: "allowance" | "deduction" | "bonus" | "arrears"; name: string; amount: string }) {
  requirePerm(actor, "payroll.prepare");
  const amount = parseNaira(input.amount);
  if (!amount || amount <= 0) throw new ValidationError("Enter a positive amount");
  if (!input.name.trim()) throw new ValidationError("Describe the item");
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(payrollLines).where(eq(payrollLines.id, lineId));
    if (!l) throw new NotFoundError("Payroll line");
    await editablePeriod(tx, l.periodId);
    await tx.insert(payrollLineItems).values({ lineId, kind: input.kind, name: input.name.trim(), amount });
    await recalcLine(tx, lineId);
    await audit(tx, actor, { action: "payroll_line_adjusted", module: "payroll", recordType: "payroll_line", recordId: lineId, newValues: { ...input, amount } });
  });
}

export async function removeLineItem(actor: Actor, itemId: number) {
  requirePerm(actor, "payroll.prepare");
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.id, itemId));
    if (!i) throw new NotFoundError("Item");
    const [l] = await tx.select().from(payrollLines).where(eq(payrollLines.id, i.lineId));
    await editablePeriod(tx, l.periodId);
    await tx.delete(payrollLineItems).where(eq(payrollLineItems.id, itemId));
    await recalcLine(tx, i.lineId);
    await audit(tx, actor, { action: "payroll_line_item_removed", module: "payroll", recordType: "payroll_line", recordId: i.lineId, oldValues: i });
  });
}

export async function submitPayroll(actor: Actor, periodId: number) {
  requirePerm(actor, "payroll.prepare");
  return db.transaction(async (tx) => {
    const p = await editablePeriod(tx, periodId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(payrollLines).where(eq(payrollLines.periodId, periodId));
    if (!n) throw new AppError("This payroll has no staff lines.");
    await tx.update(payrollPeriods).set({ status: "pending", submittedAt: new Date(), submittedBy: actor.id, rejectionReason: null }).where(eq(payrollPeriods.id, periodId));
    await hist(tx, actor, periodId, "submitted", p.status, "pending");
    await audit(tx, actor, { action: "payroll_submitted", module: "payroll", recordType: "payroll_period", recordId: periodId });
    const approvers = (await usersWithPermission(tx, "payroll.approve")).filter((u) => u !== actor.id);
    await notify(tx, approvers, { kind: "payroll_pending", title: `${p.name} awaiting approval`, link: `/payroll/periods/${periodId}` });
  });
}

export async function approvePayroll(actor: Actor, periodId: number, comment = "") {
  requirePerm(actor, "payroll.approve");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
    if (!p) throw new NotFoundError("Payroll period");
    if (p.status !== "pending") throw new AppError("Only submitted payroll can be approved.");
    if ((p.submittedBy === actor.id || p.createdBy === actor.id) && !(await getSettings()).allowSelfApprovalExpenses) throw new ForbiddenError("You prepared this payroll; another approver must approve it.");
    await tx.update(payrollPeriods).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date() }).where(eq(payrollPeriods.id, periodId));
    // Apply loan/advance repayments to balances (once, at approval).
    const loanItems = await tx.execute(sql`SELECT i.loan_id, i.amount FROM payroll_line_items i JOIN payroll_lines l ON l.id = i.line_id WHERE l.period_id = ${periodId} AND i.kind = 'loan' AND i.loan_id IS NOT NULL`);
    for (const r of loanItems.rows as { loan_id: number; amount: string }[]) {
      await tx.execute(sql`UPDATE staff_loans SET balance = balance - ${Number(r.amount)}, status = CASE WHEN balance - ${Number(r.amount)} <= 0 THEN 'settled' ELSE status END WHERE id = ${r.loan_id}`);
    }
    await hist(tx, actor, periodId, "approved", "pending", "approved", comment || null);
    await audit(tx, actor, { action: "payroll_approved", module: "payroll", recordType: "payroll_period", recordId: periodId, reason: comment || null });
    const payers = await usersWithPermission(tx, "payroll.pay");
    await notify(tx, [p.createdBy, ...payers].filter((u) => u !== actor.id), { kind: "payroll_approved", title: `${p.name} approved`, message: "Salary payments can now be recorded.", link: `/payroll/periods/${periodId}` });
  });
}

export async function rejectPayroll(actor: Actor, periodId: number, reason: string) {
  requirePerm(actor, "payroll.approve");
  if (!reason?.trim()) throw new ValidationError("A reason is required", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
    if (!p || p.status !== "pending") throw new AppError("Only submitted payroll can be rejected.");
    await tx.update(payrollPeriods).set({ status: "rejected", rejectionReason: reason }).where(eq(payrollPeriods.id, periodId));
    await hist(tx, actor, periodId, "rejected", "pending", "rejected", reason);
    await audit(tx, actor, { action: "payroll_rejected", module: "payroll", recordType: "payroll_period", recordId: periodId, reason });
    await notify(tx, [p.createdBy, p.submittedBy ?? 0], { kind: "payroll_rejected", title: `${p.name} returned for correction`, message: reason, link: `/payroll/periods/${periodId}` });
  });
}

export async function cancelPayroll(actor: Actor, periodId: number, reason: string) {
  requirePerm(actor, "payroll.prepare");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const p = await editablePeriod(tx, periodId);
    await tx.update(payrollPeriods).set({ status: "cancelled", notes: reason }).where(eq(payrollPeriods.id, periodId));
    await hist(tx, actor, periodId, "cancelled", p.status, "cancelled", reason);
    await audit(tx, actor, { action: "payroll_cancelled", module: "payroll", recordType: "payroll_period", recordId: periodId, reason });
  });
}

async function refreshPeriodStatus(tx: DBorTx, periodId: number) {
  const r = await tx.execute(sql`SELECT COALESCE(SUM(net),0)::bigint AS net, COALESCE(SUM(paid_amount),0)::bigint AS paid FROM payroll_lines WHERE period_id = ${periodId}`);
  const { net, paid } = r.rows[0] as { net: string; paid: string };
  const status = Number(paid) === 0 ? "approved" : Number(paid) >= Number(net) ? "paid" : "partially_paid";
  await tx.update(payrollPeriods).set({ status }).where(eq(payrollPeriods.id, periodId));
}

export async function paySalary(actor: Actor, lineId: number, input: { amount?: string; paymentDate: string; accountId: number; reference: string }) {
  requirePerm(actor, "payroll.pay");
  const date = parseDateInput(input.paymentDate);
  if (!date) throw new ValidationError("Invalid date");
  if (!input.reference?.trim()) throw new ValidationError("Enter the transfer/payment reference", { reference: "Required" });
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(payrollLines).where(eq(payrollLines.id, lineId)).for("update");
    if (!l) throw new NotFoundError("Payroll line");
    const [p] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, l.periodId)).for("update");
    if (!["approved", "partially_paid"].includes(p.status)) throw new AppError("Salary payments can only be recorded after the payroll is approved.");
    const remaining = l.net - l.paidAmount;
    const amount = input.amount ? parseNaira(input.amount) : remaining;
    if (!amount || amount <= 0) throw new ValidationError("Enter a positive amount");
    if (amount > remaining) throw new ValidationError(`Amount exceeds the unpaid balance of ${formatNaira(remaining)}.`);
    await assertAccountAccess(tx, actor, input.accountId);
    const [s] = await tx.select().from(staff).where(eq(staff.id, l.staffId));
    const [sp] = await tx.insert(salaryPayments).values({ lineId, amount, paymentDate: date, accountId: input.accountId, reference: input.reference.trim(), paidBy: actor.id }).returning();
    await postTxn(tx, actor, { accountId: input.accountId, txnDate: date, amount: -amount, kind: "salary", sourceType: "salary_payment", sourceId: sp.id,
      description: `Salary ${p.period} — ${s.fullName} (${s.staffNo})`, reference: input.reference.trim(), categoryName: "Salaries" });
    const paid = l.paidAmount + amount;
    await tx.update(payrollLines).set({ paidAmount: paid, status: paid >= l.net ? "paid" : "partially_paid" }).where(eq(payrollLines.id, lineId));
    await refreshPeriodStatus(tx, l.periodId);
    await audit(tx, actor, { action: "salary_paid", module: "payroll", recordType: "payroll_line", recordId: lineId, newValues: { amount, date, accountId: input.accountId, reference: input.reference } });
    return sp.id;
  });
}

/** Pay every unpaid line of an approved period from one account (bulk disbursement). */
export async function payAllSalaries(actor: Actor, periodId: number, input: { paymentDate: string; accountId: number; reference: string }) {
  requirePerm(actor, "payroll.pay");
  const lines = await db.select().from(payrollLines).where(eq(payrollLines.periodId, periodId));
  let n = 0;
  for (const l of lines) if (l.net > l.paidAmount) { await paySalary(actor, l.id, { ...input, reference: `${input.reference}` }); n++; }
  return n;
}

export async function reverseSalaryPayment(actor: Actor, salaryPaymentId: number, reason: string) {
  requirePerm(actor, "payroll.pay");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [sp] = await tx.select().from(salaryPayments).where(eq(salaryPayments.id, salaryPaymentId)).for("update");
    if (!sp || sp.status !== "posted") throw new AppError("Payment not found or already reversed.");
    const [l] = await tx.select().from(payrollLines).where(eq(payrollLines.id, sp.lineId)).for("update");
    await tx.update(salaryPayments).set({ status: "reversed", reversedAt: new Date(), reversedBy: actor.id, reversalReason: reason }).where(eq(salaryPayments.id, salaryPaymentId));
    await postTxn(tx, actor, { accountId: sp.accountId, txnDate: todayISO(), amount: sp.amount, kind: "salary_reversal", sourceType: "salary_payment", sourceId: sp.id, description: `Reversal of salary payment: ${reason}`, reference: sp.reference ?? "" });
    const paid = l.paidAmount - sp.amount;
    await tx.update(payrollLines).set({ paidAmount: paid, status: paid <= 0 ? "unpaid" : "partially_paid" }).where(eq(payrollLines.id, l.id));
    await refreshPeriodStatus(tx, l.periodId);
    await audit(tx, actor, { action: "salary_payment_reversed", module: "payroll", recordType: "salary_payment", recordId: salaryPaymentId, reason });
  });
}

export async function listPeriods(actor: Actor) {
  requirePerm(actor, "payroll.view");
  const r = await db.execute(sql`SELECT p.*, COUNT(l.id)::int AS staff_count, COALESCE(SUM(l.gross),0)::bigint AS gross, COALESCE(SUM(l.deductions + l.loan_deduction),0)::bigint AS deductions,
      COALESCE(SUM(l.net),0)::bigint AS net, COALESCE(SUM(l.paid_amount),0)::bigint AS paid, u.full_name AS approved_by_name
    FROM payroll_periods p LEFT JOIN payroll_lines l ON l.period_id = p.id LEFT JOIN users u ON u.id = p.approved_by GROUP BY p.id, u.full_name ORDER BY p.period DESC`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({ ...x, gross: Number(x.gross), deductions: Number(x.deductions), net: Number(x.net), paid: Number(x.paid) })) as
    { id: number; period: string; name: string; status: string; staff_count: number; gross: number; deductions: number; net: number; paid: number; approved_by_name: string | null; pay_date: string }[];
}

export async function getPeriod(actor: Actor, periodId: number) {
  requirePerm(actor, "payroll.view");
  const [p] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
  if (!p) throw new NotFoundError("Payroll period");
  const lines = await db.execute(sql`SELECT l.*, s.staff_no, s.full_name, s.department, s.position, s.bank_name, s.bank_account_number FROM payroll_lines l JOIN staff s ON s.id = l.staff_id WHERE l.period_id = ${periodId} ORDER BY s.full_name`);
  const lineIds = (lines.rows as { id: number }[]).map((l) => l.id);
  const items = lineIds.length ? await db.select().from(payrollLineItems).where(inArray(payrollLineItems.lineId, lineIds)) : [];
  const pays = lineIds.length ? await db.execute(sql`SELECT sp.*, a.name AS account_name, u.full_name AS paid_by_name FROM salary_payments sp JOIN accounts a ON a.id = sp.account_id JOIN users u ON u.id = sp.paid_by
    WHERE sp.line_id IN (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY sp.paid_at`) : { rows: [] };
  const h = await db.select({ h: workflowHistory, by: users.fullName }).from(workflowHistory).innerJoin(users, eq(users.id, workflowHistory.actorId))
    .where(and(eq(workflowHistory.entityType, "payroll"), eq(workflowHistory.entityId, periodId))).orderBy(asc(workflowHistory.at));
  const num = (x: unknown) => Number(x);
  return {
    period: p,
    lines: (lines.rows as Record<string, unknown>[]).map((l) => ({ id: l.id as number, staffId: l.staff_id as number, staffNo: l.staff_no as string, fullName: l.full_name as string, department: l.department as string, position: l.position as string,
      bankName: l.bank_name as string, bankAccountNumber: l.bank_account_number as string, basic: num(l.basic), allowances: num(l.allowances), bonus: num(l.bonus), arrears: num(l.arrears), deductions: num(l.deductions),
      loanDeduction: num(l.loan_deduction), gross: num(l.gross), net: num(l.net), paidAmount: num(l.paid_amount), status: l.status as string })),
    items, payments: (pays.rows as Record<string, unknown>[]).map((x) => ({ ...x, amount: Number(x.amount) })) as { id: number; line_id: number; amount: number; payment_date: string; account_name: string; reference: string; status: string; paid_by_name: string }[],
    history: h.map((x) => ({ ...x.h, actorName: x.by })),
  };
}
