/**
 * Expenses: Draft → Pending → Approved (unpaid) → Paid;  Pending → Rejected;  Draft/Pending/Approved → Cancelled;  Paid → Reversed.
 * Both Finance and the Director can record expenses. Self-approval is controlled by school policy
 * (Settings → "Allow self-approval of expenses"); when off, the Director's own entries need a second approver.
 * Only PAID expenses post a cash outflow to the account book. Approved-but-unpaid is a liability, not cash.
 */
import { db, DBorTx } from "@/db";
import { expenses, expenseCategories, vendors, workflowHistory, users, attachments, roles } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { Actor, can, requirePerm, requireAny } from "../actor";
import { audit, notify, usersWithPermission } from "../audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatNaira, parseNaira } from "@/lib/money";
import { parseDateInput, todayISO } from "@/lib/dates";
import { assertAccountAccess, postTxn } from "./accounts";
import { nextNumber } from "../numbering";
import { getSettings } from "./admin";
import { saveAttachment, UploadFile } from "../files";

export const DEFAULT_EXPENSE_CATEGORIES = ["Salaries", "Utilities", "Maintenance", "Academic Materials", "Transport / Fuel", "Food", "Administration",
  "Security", "Marketing", "Capital Expenditure", "Taxes / Charges", "Bank Charges", "Miscellaneous"];

// ───────── Categories & vendors ─────────

export const listExpenseCategories = () => db.select().from(expenseCategories).orderBy(asc(expenseCategories.name));
export const listVendors = () => db.select().from(vendors).orderBy(asc(vendors.name));

export async function saveExpenseCategory(actor: Actor, id: number | null, input: { name: string; parentId?: number | null; active: boolean }) {
  requirePerm(actor, "expenses.manage_categories");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Category name is required");
  return db.transaction(async (tx) => {
    const values = { name, parentId: input.parentId ?? null, active: input.active };
    if (id) await tx.update(expenseCategories).set(values).where(eq(expenseCategories.id, id));
    else id = (await tx.insert(expenseCategories).values(values).returning())[0].id;
    await audit(tx, actor, { action: "expense_category_saved", module: "expenses", recordType: "expense_category", recordId: id, newValues: values });
    return id;
  });
}

export async function saveVendor(actor: Actor, id: number | null, input: { name: string; contactPerson?: string; phone?: string; email?: string; active?: boolean }) {
  requireAny(actor, "expenses.manage_categories", "expenses.create");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Vendor name is required");
  return db.transaction(async (tx) => {
    const values = { name, contactPerson: input.contactPerson ?? "", phone: input.phone ?? "", email: input.email ?? "", active: input.active ?? true };
    const dup = await tx.select().from(vendors).where(eq(vendors.name, name));
    if (dup.length && dup[0].id !== id) throw new ConflictError("A vendor with this name already exists.");
    if (id) await tx.update(vendors).set(values).where(eq(vendors.id, id));
    else id = (await tx.insert(vendors).values(values).returning())[0].id;
    await audit(tx, actor, { action: "vendor_saved", module: "expenses", recordType: "vendor", recordId: id, newValues: values });
    return id;
  });
}

// ───────── Expense records ─────────

export const expenseSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(150),
  description: z.string().trim().max(2000).default(""),
  categoryId: z.coerce.number().int().positive("Choose a category"),
  subcategory: z.string().trim().max(80).default(""),
  amount: z.string().min(1, "Amount is required"),
  dateIncurred: z.string().min(1, "Date is required"),
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  payeeName: z.string().trim().max(150).default(""),
  paymentMethod: z.string().trim().max(40).default(""),
  accountId: z.coerce.number().int().positive().nullable().optional(),
  recurring: z.boolean().default(false),
  recurrence: z.string().trim().max(40).nullable().optional(),
  department: z.string().trim().max(80).default(""),
  idempotencyKey: z.string().max(80).optional(),
});

async function hist(tx: DBorTx, actor: Actor, id: number, action: string, from: string | null, to: string, comment?: string | null) {
  await tx.insert(workflowHistory).values({ entityType: "expense", entityId: id, action, fromStatus: from, toStatus: to, actorId: actor.id, comment: comment ?? null });
}

function parse(input: z.input<typeof expenseSchema>) {
  const d = expenseSchema.parse(input);
  const amount = parseNaira(d.amount);
  if (!amount || amount <= 0) throw new ValidationError("Enter a positive amount", { amount: "Invalid amount" });
  const dateIncurred = parseDateInput(d.dateIncurred);
  if (!dateIncurred) throw new ValidationError("Invalid date", { dateIncurred: "Invalid date" });
  if (!d.vendorId && !d.payeeName) throw new ValidationError("Enter the payee or choose a vendor", { payeeName: "Payee or vendor required" });
  if (d.recurring && !d.recurrence) throw new ValidationError("Choose how often this expense recurs", { recurrence: "Required" });
  return { d, amount, dateIncurred };
}

async function notifyApprovers(tx: DBorTx, actor: Actor, id: number, no: string, amount: number, title: string) {
  const approvers = (await usersWithPermission(tx, "expenses.approve")).filter((u) => u !== actor.id || (false));
  await notify(tx, approvers, { kind: "expense_pending", title: `Expense ${no} awaiting approval`, message: `${title} — ${formatNaira(amount)} by ${actor.fullName}`, link: `/expenses/${id}` });
}

export async function createExpense(actor: Actor, input: z.input<typeof expenseSchema>, opts: { submit: boolean; evidence?: UploadFile | null }) {
  requirePerm(actor, "expenses.create");
  const { d, amount, dateIncurred } = parse(input);
  return db.transaction(async (tx) => {
    if (d.idempotencyKey) {
      const [ex] = await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.idempotencyKey, d.idempotencyKey));
      if (ex) return ex.id;
    }
    if (d.accountId) await assertAccountAccess(tx, actor, d.accountId);
    const expenseNo = await nextNumber(tx, "EXP");
    const status = opts.submit ? "pending" : "draft";
    const [e] = await tx.insert(expenses).values({
      expenseNo, title: d.title, description: d.description, categoryId: d.categoryId, subcategory: d.subcategory, amount, dateIncurred, vendorId: d.vendorId ?? null,
      payeeName: d.payeeName, paymentMethod: d.paymentMethod, accountId: d.accountId ?? null, recurring: d.recurring, recurrence: d.recurring ? d.recurrence : null,
      department: d.department, status, createdBy: actor.id, submittedAt: opts.submit ? new Date() : null, idempotencyKey: d.idempotencyKey ?? null,
    }).returning();
    if (opts.evidence) await saveAttachment(tx, actor, "expense", e.id, opts.evidence);
    await hist(tx, actor, e.id, opts.submit ? "submitted" : "created", null, status);
    await audit(tx, actor, { action: opts.submit ? "expense_submitted" : "expense_created", module: "expenses", recordType: "expense", recordId: e.id, newValues: e });
    if (opts.submit) await notifyApprovers(tx, actor, e.id, expenseNo, amount, d.title);
    return e.id;
  });
}

export async function updateExpenseDraft(actor: Actor, id: number, input: z.input<typeof expenseSchema>) {
  requirePerm(actor, "expenses.create");
  const { d, amount, dateIncurred } = parse(input);
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!old) throw new NotFoundError("Expense");
    if (old.status !== "draft") throw new AppError("Only draft expenses can be edited. Approved and paid expenses are corrected by cancellation or reversal.");
    if (old.createdBy !== actor.id) throw new ForbiddenError("You can only edit your own drafts.");
    const patch = { title: d.title, description: d.description, categoryId: d.categoryId, subcategory: d.subcategory, amount, dateIncurred, vendorId: d.vendorId ?? null,
      payeeName: d.payeeName, paymentMethod: d.paymentMethod, accountId: d.accountId ?? null, recurring: d.recurring, recurrence: d.recurring ? d.recurrence : null, department: d.department };
    await tx.update(expenses).set(patch).where(eq(expenses.id, id));
    await audit(tx, actor, { action: "expense_draft_updated", module: "expenses", recordType: "expense", recordId: id, oldValues: old, newValues: patch });
  });
}

export async function submitExpense(actor: Actor, id: number) {
  requirePerm(actor, "expenses.create");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (e.status !== "draft") throw new AppError("Only drafts can be submitted.");
    if (e.createdBy !== actor.id) throw new ForbiddenError("Only the person who recorded this draft can submit it.");
    await tx.update(expenses).set({ status: "pending", submittedAt: new Date() }).where(eq(expenses.id, id));
    await hist(tx, actor, id, "submitted", "draft", "pending");
    await audit(tx, actor, { action: "expense_submitted", module: "expenses", recordType: "expense", recordId: id });
    await notifyApprovers(tx, actor, id, e.expenseNo, e.amount, e.title);
  });
}

export async function approveExpense(actor: Actor, id: number, comment = "") {
  requirePerm(actor, "expenses.approve");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (e.status !== "pending") throw new AppError(`Only pending expenses can be approved (status: ${e.status}).`);
    const s = await getSettings();
    if (e.createdBy === actor.id && !s.allowSelfApprovalExpenses) {
      throw new ForbiddenError("You recorded this expense. School policy requires a second approver for your own entries.");
    }
    await tx.update(expenses).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), approvalComment: comment || null }).where(eq(expenses.id, id));
    await hist(tx, actor, id, e.createdBy === actor.id ? "self_approved" : "approved", "pending", "approved", comment || (e.createdBy === actor.id ? "Self-approved under school policy" : null));
    await audit(tx, actor, { action: e.createdBy === actor.id ? "expense_self_approved" : "expense_approved", module: "expenses", recordType: "expense", recordId: id, oldValues: { status: "pending" }, newValues: { status: "approved" }, reason: comment || null });
    await notify(tx, [e.createdBy].filter((u) => u !== actor.id), { kind: "expense_approved", title: `Expense ${e.expenseNo} approved`, message: "Approved — awaiting payment", link: `/expenses/${id}` });
    const payers = (await usersWithPermission(tx, "expenses.pay")).filter((u) => u !== actor.id);
    await notify(tx, payers, { kind: "expense_to_pay", title: `Expense ${e.expenseNo} approved, unpaid`, message: `${e.title} — ${formatNaira(e.amount)}`, link: `/expenses/${id}` });
  });
}

export async function rejectExpense(actor: Actor, id: number, reason: string) {
  requirePerm(actor, "expenses.approve");
  if (!reason?.trim()) throw new ValidationError("A rejection reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (e.status !== "pending") throw new AppError("Only pending expenses can be rejected.");
    await tx.update(expenses).set({ status: "rejected", rejectedBy: actor.id, rejectedAt: new Date(), rejectionReason: reason }).where(eq(expenses.id, id));
    await hist(tx, actor, id, "rejected", "pending", "rejected", reason);
    await audit(tx, actor, { action: "expense_rejected", module: "expenses", recordType: "expense", recordId: id, reason });
    await notify(tx, [e.createdBy], { kind: "expense_rejected", title: `Expense ${e.expenseNo} rejected`, message: reason, link: `/expenses/${id}` });
  });
}

export async function payExpense(actor: Actor, id: number, input: { paidDate: string; accountId: number; reference: string; evidence?: UploadFile | null }) {
  requirePerm(actor, "expenses.pay");
  const paidDate = parseDateInput(input.paidDate);
  if (!paidDate) throw new ValidationError("Invalid payment date", { paidDate: "Invalid date" });
  if (paidDate > todayISO()) throw new ValidationError("Payment date cannot be in the future");
  if (!input.reference?.trim()) throw new ValidationError("Enter the payment/transaction reference", { reference: "Required" });
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (e.status === "paid") throw new ConflictError("This expense is already marked as paid.");
    if (e.status !== "approved") throw new AppError("Only approved expenses can be paid.");
    await assertAccountAccess(tx, actor, input.accountId);
    await tx.update(expenses).set({ status: "paid", paidBy: actor.id, paidAt: new Date(), paidDate, paidAccountId: input.accountId, paidReference: input.reference.trim() }).where(eq(expenses.id, id));
    const [cat] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, e.categoryId));
    await postTxn(tx, actor, { accountId: input.accountId, txnDate: paidDate, amount: -e.amount, kind: "expense", sourceType: "expense", sourceId: id,
      description: `${e.expenseNo}: ${e.title}`, reference: input.reference.trim(), categoryName: cat?.name });
    if (input.evidence) await saveAttachment(tx, actor, "expense", id, input.evidence);
    await hist(tx, actor, id, "paid", "approved", "paid", `Paid ${paidDate} ref ${input.reference}`);
    await audit(tx, actor, { action: "expense_paid", module: "expenses", recordType: "expense", recordId: id, newValues: { paidDate, accountId: input.accountId, reference: input.reference } });
  });
}

export async function cancelExpense(actor: Actor, id: number, reason: string) {
  if (!reason?.trim()) throw new ValidationError("A reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (!["draft", "pending", "approved"].includes(e.status)) throw new AppError(e.status === "paid" ? "A paid expense must be reversed, not cancelled." : `Cannot cancel an expense that is ${e.status}.`);
    const own = e.createdBy === actor.id && ["draft", "pending"].includes(e.status);
    if (!own) requirePerm(actor, "expenses.cancel");
    await tx.update(expenses).set({ status: "cancelled", cancelledBy: actor.id, cancelledAt: new Date(), cancelReason: reason }).where(eq(expenses.id, id));
    await hist(tx, actor, id, "cancelled", e.status, "cancelled", reason);
    await audit(tx, actor, { action: "expense_cancelled", module: "expenses", recordType: "expense", recordId: id, oldValues: { status: e.status }, reason });
  });
}

export async function reverseExpense(actor: Actor, id: number, reason: string) {
  requirePerm(actor, "expenses.cancel");
  if (!reason?.trim()) throw new ValidationError("A reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new NotFoundError("Expense");
    if (e.status !== "paid") throw new AppError("Only paid expenses can be reversed.");
    await tx.update(expenses).set({ status: "reversed", cancelledBy: actor.id, cancelledAt: new Date(), cancelReason: reason }).where(eq(expenses.id, id));
    await postTxn(tx, actor, { accountId: e.paidAccountId!, txnDate: todayISO(), amount: e.amount, kind: "expense_reversal", sourceType: "expense", sourceId: id,
      description: `Reversal of ${e.expenseNo}: ${reason}`, reference: e.paidReference ?? "" });
    await hist(tx, actor, id, "reversed", "paid", "reversed", reason);
    await audit(tx, actor, { action: "expense_reversed", module: "expenses", recordType: "expense", recordId: id, reason });
  });
}

/** Copy a recurring expense into a new draft for the next occurrence. */
export async function duplicateExpense(actor: Actor, id: number, dateIncurred: string) {
  requirePerm(actor, "expenses.create");
  const [e] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!e) throw new NotFoundError("Expense");
  return createExpense(actor, {
    title: e.title, description: e.description ?? "", categoryId: e.categoryId, subcategory: e.subcategory ?? "", amount: (e.amount / 100).toFixed(2),
    dateIncurred, vendorId: e.vendorId, payeeName: e.payeeName ?? "", paymentMethod: e.paymentMethod ?? "", accountId: e.accountId, recurring: e.recurring,
    recurrence: e.recurrence, department: e.department ?? "",
  }, { submit: false });
}

export interface ExpenseFilter { q?: string; status?: string; categoryId?: number; accountId?: number; createdBy?: number; approvedBy?: number; vendorId?: number; from?: string; to?: string; entrantRole?: "director" | "other"; payee?: string; recurring?: boolean; dateBasis?: "incurred" | "paid" }

export async function listExpenses(actor: Actor, f: ExpenseFilter = {}) {
  requireAny(actor, "expenses.view", "expenses.create", "expenses.approve");
  const w = [sql`true`];
  const dcol = f.dateBasis === "paid" ? sql`e.paid_date` : sql`e.date_incurred`;
  if (f.status) w.push(f.status === "unpaid" ? sql`e.status = 'approved'` : sql`e.status = ${f.status}`);
  if (f.categoryId) w.push(sql`(e.category_id = ${f.categoryId} OR ec.parent_id = ${f.categoryId})`);
  if (f.accountId) w.push(sql`COALESCE(e.paid_account_id, e.account_id) = ${f.accountId}`);
  if (f.createdBy) w.push(sql`e.created_by = ${f.createdBy}`);
  if (f.approvedBy) w.push(sql`e.approved_by = ${f.approvedBy}`);
  if (f.vendorId) w.push(sql`e.vendor_id = ${f.vendorId}`);
  if (f.payee) w.push(sql`(e.payee_name ILIKE ${"%" + f.payee + "%"} OR v.name ILIKE ${"%" + f.payee + "%"})`);
  if (f.from) w.push(sql`${dcol} >= ${f.from}`);
  if (f.to) w.push(sql`${dcol} <= ${f.to}`);
  if (f.recurring) w.push(sql`e.recurring`);
  if (f.entrantRole === "director") w.push(sql`cr.is_system`);
  if (f.entrantRole === "other") w.push(sql`NOT cr.is_system`);
  if (f.q) { const q = `%${f.q}%`; w.push(sql`(e.expense_no ILIKE ${q} OR e.title ILIKE ${q} OR e.payee_name ILIKE ${q} OR v.name ILIKE ${q} OR e.paid_reference ILIKE ${q})`); }
  if (actor.dataScope === "own" && !can(actor, "expenses.approve")) w.push(sql`e.created_by = ${actor.id}`);
  const res = await db.execute(sql`
    SELECT e.id, e.expense_no AS "expenseNo", e.title, e.status, e.amount::bigint AS amount, e.date_incurred AS "dateIncurred", e.paid_date AS "paidDate",
      e.paid_reference AS "paidReference", e.recurring, e.recurrence, e.department, e.subcategory,
      ec.name AS "categoryName", pc.name AS "parentCategoryName", COALESCE(v.name, e.payee_name) AS payee, v.name AS "vendorName",
      COALESCE(pa.name, a.name) AS "accountName", cu.full_name AS "createdByName", cr.name AS "createdByRole", cr.is_system AS "createdByDirector",
      au.full_name AS "approvedByName", e.created_at AS "createdAt", e.approved_at AS "approvedAt", e.rejection_reason AS "rejectionReason", e.cancel_reason AS "cancelReason",
      (SELECT count(*)::int FROM attachments x WHERE x.entity_type = 'expense' AND x.entity_id = e.id) AS "evidenceCount"
    FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      LEFT JOIN expense_categories pc ON pc.id = ec.parent_id
      LEFT JOIN vendors v ON v.id = e.vendor_id
      LEFT JOIN accounts a ON a.id = e.account_id
      LEFT JOIN accounts pa ON pa.id = e.paid_account_id
      JOIN users cu ON cu.id = e.created_by
      JOIN roles cr ON cr.id = cu.role_id
      LEFT JOIN users au ON au.id = e.approved_by
    WHERE ${sql.join(w, sql` AND `)}
    ORDER BY e.date_incurred DESC, e.id DESC`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({ ...r, amount: Number(r.amount), dateIncurred: String(r.dateIncurred).slice(0, 10), paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : null })) as ExpenseRow[];
}

export interface ExpenseRow {
  id: number; expenseNo: string; title: string; status: string; amount: number; dateIncurred: string; paidDate: string | null; paidReference: string | null; recurring: boolean;
  recurrence: string | null; department: string; subcategory: string; categoryName: string; parentCategoryName: string | null; payee: string; vendorName: string | null; accountName: string | null;
  createdByName: string; createdByRole: string; createdByDirector: boolean; approvedByName: string | null; createdAt: Date; approvedAt: Date | null; rejectionReason: string | null; cancelReason: string | null; evidenceCount: number;
}

export async function getExpense(actor: Actor, id: number) {
  requireAny(actor, "expenses.view", "expenses.create", "expenses.approve");
  const [e] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!e) throw new NotFoundError("Expense");
  if (actor.dataScope === "own" && !can(actor, "expenses.approve") && e.createdBy !== actor.id) throw new ForbiddenError();
  const [row] = (await listExpenses({ ...actor, dataScope: "all" }, {})).filter((r) => r.id === id);
  const ev = await db.select().from(attachments).where(and(eq(attachments.entityType, "expense"), eq(attachments.entityId, id)));
  const h = await db.select({ h: workflowHistory, by: users.fullName }).from(workflowHistory).innerJoin(users, eq(users.id, workflowHistory.actorId))
    .where(and(eq(workflowHistory.entityType, "expense"), eq(workflowHistory.entityId, id))).orderBy(asc(workflowHistory.at));
  const s = await getSettings();
  return { expense: e, row, evidence: ev, history: h.map((x) => ({ ...x.h, actorName: x.by })), selfCreated: e.createdBy === actor.id, allowSelf: s.allowSelfApprovalExpenses };
}

export async function expenseSummary() {
  const r = await db.execute(sql`SELECT status, count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS total FROM expenses GROUP BY status`);
  return (r.rows as { status: string; n: number; total: string }[]).map((x) => ({ ...x, total: Number(x.total) }));
}

export { roles };
