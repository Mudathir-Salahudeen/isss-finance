import { db, DBorTx } from "@/db";
import { fees, feeCategories, feeClassAmounts, feeCharges, feeAssignments, feeAdjustments, enrolments, students, paymentAllocations, payments, academicSessions, terms } from "@/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { Actor, requirePerm } from "../actor";
import { audit } from "../audit";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseNaira } from "@/lib/money";
import { parseDateInput } from "@/lib/dates";
import { chargeBalances } from "./ledger";

// ───────── Categories ─────────

export const listFeeCategories = () => db.select().from(feeCategories).orderBy(asc(feeCategories.name));

export async function saveFeeCategory(actor: Actor, id: number | null, name: string, active = true) {
  requirePerm(actor, "fees.manage");
  name = name.trim();
  if (name.length < 2) throw new ValidationError("Category name is required");
  return db.transaction(async (tx) => {
    const dup = await tx.select().from(feeCategories).where(eq(feeCategories.name, name));
    if (dup.length && dup[0].id !== id) throw new ConflictError("This category already exists.");
    if (id) await tx.update(feeCategories).set({ name, active }).where(eq(feeCategories.id, id));
    else id = (await tx.insert(feeCategories).values({ name, active }).returning())[0].id;
    await audit(tx, actor, { action: "fee_category_saved", module: "fees", recordType: "fee_category", recordId: id, newValues: { name, active } });
    return id;
  });
}

// ───────── Fees ─────────

export const feeSchema = z.object({
  name: z.string().trim().min(2, "Fee name is required").max(100),
  description: z.string().trim().default(""),
  categoryId: z.coerce.number().int().positive("Choose a category"),
  amount: z.string().min(1, "Amount is required"),
  sessionId: z.coerce.number().int().positive("Choose a session"),
  termId: z.coerce.number().int().positive().nullable().optional(),
  mandatory: z.boolean().default(true),
  dueDate: z.string().optional().nullable(),
  allowPartial: z.boolean().default(true),
  recurring: z.boolean().default(false),
  frequency: z.string().optional().nullable(),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
  classAmounts: z.record(z.string(), z.string()).default({}), // classId -> amount
});

export async function listFees(f: { sessionId?: number; termId?: number; status?: string; categoryId?: number } = {}) {
  const conds = [eq(fees.isSystem, false)];
  if (f.sessionId) conds.push(eq(fees.sessionId, f.sessionId));
  if (f.termId) conds.push(eq(fees.termId, f.termId));
  if (f.status) conds.push(eq(fees.status, f.status));
  if (f.categoryId) conds.push(eq(fees.categoryId, f.categoryId));
  return db.select({
    id: fees.id, name: fees.name, amount: fees.amount, status: fees.status, mandatory: fees.mandatory, dueDate: fees.dueDate, allowPartial: fees.allowPartial,
    recurring: fees.recurring, categoryName: feeCategories.name, sessionName: academicSessions.name, termName: terms.name, sessionId: fees.sessionId, termId: fees.termId,
    chargeCount: sql<number>`(SELECT count(*)::int FROM fee_charges c WHERE c.fee_id = ${fees.id} AND c.status = 'active')`,
    expected: sql<number>`(SELECT COALESCE(SUM(c.amount + COALESCE((SELECT SUM(a.amount) FROM fee_adjustments a WHERE a.charge_id = c.id AND a.reversed_at IS NULL),0)),0)::bigint FROM fee_charges c WHERE c.fee_id = ${fees.id} AND c.status = 'active')`.mapWith(Number),
  }).from(fees)
    .innerJoin(feeCategories, eq(feeCategories.id, fees.categoryId))
    .innerJoin(academicSessions, eq(academicSessions.id, fees.sessionId))
    .leftJoin(terms, eq(terms.id, fees.termId))
    .where(and(...conds)).orderBy(desc(academicSessions.name), asc(terms.seq), asc(fees.name));
}

export async function getFee(id: number) {
  const [f] = await db.select().from(fees).where(eq(fees.id, id));
  if (!f) throw new NotFoundError("Fee");
  const classAmounts = await db.select().from(feeClassAmounts).where(eq(feeClassAmounts.feeId, id));
  const assignments = await db.select().from(feeAssignments).where(eq(feeAssignments.feeId, id)).orderBy(desc(feeAssignments.createdAt));
  return { fee: f, classAmounts, assignments };
}

function parseFee(input: z.input<typeof feeSchema>) {
  const d = feeSchema.parse(input);
  const amount = parseNaira(d.amount);
  if (amount === null || amount < 0) throw new ValidationError("Enter a valid amount", { amount: "Enter a valid amount in ₦" });
  const dueDate = d.dueDate ? parseDateInput(d.dueDate) : null;
  if (d.dueDate && !dueDate) throw new ValidationError("Invalid due date", { dueDate: "Invalid date" });
  const classAmounts: { classId: number; amount: number }[] = [];
  for (const [cid, raw] of Object.entries(d.classAmounts)) {
    if (!raw?.trim()) continue;
    const a = parseNaira(raw);
    if (a === null || a < 0) throw new ValidationError(`Invalid class-specific amount`, { [`class_${cid}`]: "Invalid amount" });
    classAmounts.push({ classId: Number(cid), amount: a });
  }
  if (d.recurring && !d.frequency) throw new ValidationError("Choose a frequency for a recurring fee", { frequency: "Required" });
  return { d, amount, dueDate, classAmounts };
}

export async function createFee(actor: Actor, input: z.input<typeof feeSchema>) {
  requirePerm(actor, "fees.manage");
  const { d, amount, dueDate, classAmounts } = parseFee(input);
  return db.transaction(async (tx) => {
    if (d.termId) {
      const [t] = await tx.select().from(terms).where(eq(terms.id, d.termId));
      if (!t || t.sessionId !== d.sessionId) throw new ValidationError("Term does not belong to the selected session", { termId: "Wrong session" });
    }
    const [f] = await tx.insert(fees).values({
      name: d.name, description: d.description, categoryId: d.categoryId, amount, sessionId: d.sessionId, termId: d.termId ?? null,
      mandatory: d.mandatory, dueDate, allowPartial: d.allowPartial, recurring: d.recurring, frequency: d.recurring ? d.frequency : null, status: d.status, createdBy: actor.id,
    }).returning();
    if (classAmounts.length) await tx.insert(feeClassAmounts).values(classAmounts.map((c) => ({ ...c, feeId: f.id })));
    await audit(tx, actor, { action: "fee_created", module: "fees", recordType: "fee", recordId: f.id, newValues: { ...f, classAmounts } });
    return f.id;
  });
}

/** Edit a fee. Amounts/session/term are locked once charges exist (create an adjustment or a new fee instead). */
export async function updateFee(actor: Actor, id: number, input: z.input<typeof feeSchema>) {
  requirePerm(actor, "fees.manage");
  const { d, amount, dueDate, classAmounts } = parseFee(input);
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(fees).where(eq(fees.id, id));
    if (!old) throw new NotFoundError("Fee");
    if (old.isSystem) throw new AppError("System fees cannot be edited.");
    if (old.status === "cancelled") throw new AppError("A cancelled fee cannot be edited.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(feeCharges).where(eq(feeCharges.feeId, id));
    const oldClass = await tx.select().from(feeClassAmounts).where(eq(feeClassAmounts.feeId, id));
    if (n > 0) {
      const sameClass = JSON.stringify(oldClass.map((c) => [c.classId, c.amount]).sort()) === JSON.stringify(classAmounts.map((c) => [c.classId, c.amount]).sort());
      if (amount !== old.amount || d.sessionId !== old.sessionId || (d.termId ?? null) !== old.termId || !sameClass) {
        throw new AppError("This fee has already been charged to students, so its amount, session and term are locked. Use an adjustment/waiver, or create a new fee.");
      }
    }
    const patch = {
      name: d.name, description: d.description, categoryId: d.categoryId, amount, sessionId: d.sessionId, termId: d.termId ?? null, mandatory: d.mandatory,
      dueDate, allowPartial: d.allowPartial, recurring: d.recurring, frequency: d.recurring ? d.frequency : null, status: d.status,
    };
    await tx.update(fees).set(patch).where(eq(fees.id, id));
    if (n === 0) {
      await tx.delete(feeClassAmounts).where(eq(feeClassAmounts.feeId, id));
      if (classAmounts.length) await tx.insert(feeClassAmounts).values(classAmounts.map((c) => ({ ...c, feeId: id })));
    }
    if (dueDate !== old.dueDate) {
      // Propagate due date to charges that still follow the fee's due date.
      await tx.update(feeCharges).set({ dueDate }).where(and(eq(feeCharges.feeId, id), sql`${feeCharges.dueDate} IS NOT DISTINCT FROM ${old.dueDate}`));
    }
    await audit(tx, actor, { action: "fee_updated", module: "fees", recordType: "fee", recordId: id, oldValues: { ...old, classAmounts: oldClass }, newValues: { ...patch, classAmounts } });
  });
}

/**
 * Change status. "cancelled" never deletes anything: it stops further assignment, and (optionally) cancels
 * charges that have no approved or pending payment against them. Charges with payments stay on the ledger.
 */
export async function setFeeStatus(actor: Actor, id: number, status: "active" | "inactive" | "cancelled", reason: string, cancelUnpaidCharges = false) {
  requirePerm(actor, "fees.manage");
  if (status === "cancelled" && !reason?.trim()) throw new ValidationError("A reason is required to cancel a fee", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(fees).where(eq(fees.id, id));
    if (!old) throw new NotFoundError("Fee");
    if (old.status === "cancelled") throw new AppError("This fee is already cancelled.");
    await tx.update(fees).set({ status, cancelledReason: status === "cancelled" ? reason : null }).where(eq(fees.id, id));
    let cancelledCharges = 0;
    if (status === "cancelled" && cancelUnpaidCharges) {
      const rows = await tx.execute(sql`UPDATE fee_charges c SET status = 'cancelled', cancelled_at = now(), cancelled_reason = ${"Fee cancelled: " + reason}
        WHERE c.fee_id = ${id} AND c.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.charge_id = c.id AND p.status IN ('approved','pending','draft'))
        RETURNING c.id`);
      cancelledCharges = rows.rows.length;
    }
    await audit(tx, actor, { action: `fee_${status}`, module: "fees", recordType: "fee", recordId: id, oldValues: { status: old.status }, newValues: { status, cancelledCharges }, reason });
    return { cancelledCharges };
  });
}

// ───────── Assignment ─────────

export type AssignScope = { mode: "all" | "classes" | "students"; classIds?: number[]; armIds?: number[]; studentIds?: number[] };

async function eligible(tx: DBorTx, feeId: number, scope: AssignScope) {
  const [f] = await tx.select().from(fees).where(eq(fees.id, feeId));
  if (!f) throw new NotFoundError("Fee");
  const conds = [eq(enrolments.sessionId, f.sessionId), sql`${enrolments.status} <> 'reversed'`];
  if (scope.mode === "classes") {
    if (!scope.classIds?.length && !scope.armIds?.length) throw new ValidationError("Choose at least one class or arm.");
    if (scope.armIds?.length) conds.push(inArray(enrolments.armId, scope.armIds));
    else conds.push(inArray(enrolments.classId, scope.classIds!));
  }
  if (scope.mode === "students") {
    if (!scope.studentIds?.length) throw new ValidationError("Choose at least one student.");
    conds.push(inArray(enrolments.studentId, scope.studentIds));
  }
  const rows = await tx.select({
    studentId: students.id, enrolmentId: enrolments.id, classId: enrolments.classId, armId: enrolments.armId, status: students.status,
    admissionNo: students.admissionNo, name: sql<string>`${students.lastName} || ', ' || ${students.firstName}`,
  }).from(enrolments).innerJoin(students, eq(students.id, enrolments.studentId)).where(and(...conds));
  const classAmts = await tx.select().from(feeClassAmounts).where(eq(feeClassAmounts.feeId, feeId));
  const existing = new Set((await tx.select({ s: feeCharges.studentId }).from(feeCharges).where(eq(feeCharges.feeId, feeId))).map((r) => r.s));
  const toCharge: (typeof rows[number] & { amount: number })[] = [];
  const skipped: { studentId: number; admissionNo: string; name: string; reason: string }[] = [];
  for (const r of rows) {
    if (existing.has(r.studentId)) { skipped.push({ ...r, reason: "Already assigned" }); continue; }
    // Withdrawn/transferred/graduated students are excluded from ordinary assignment (explicit student selection can include suspended only).
    if (r.status !== "active" && !(scope.mode === "students" && r.status === "suspended")) { skipped.push({ ...r, reason: `Student is ${r.status}` }); continue; }
    const amount = classAmts.find((c) => c.classId === r.classId)?.amount ?? f.amount;
    toCharge.push({ ...r, amount });
  }
  return { fee: f, toCharge, skipped };
}

export async function previewAssignment(actor: Actor, feeId: number, scope: AssignScope) {
  requirePerm(actor, "fees.assign");
  const { toCharge, skipped } = await eligible(db, feeId, scope);
  return { studentCount: toCharge.length, totalAmount: toCharge.reduce((t, r) => t + r.amount, 0), students: toCharge, skipped };
}

/** Idempotent: a student can only ever be charged once per fee (unique index + pre-check). */
export async function assignFee(actor: Actor, feeId: number, scope: AssignScope) {
  requirePerm(actor, "fees.assign");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${1000000 + feeId})`); // serialise concurrent assignment of the same fee
    const { fee, toCharge, skipped } = await eligible(tx, feeId, scope);
    if (fee.status !== "active") throw new AppError("Only an active fee can be assigned. Activate it first.");
    if (fee.isSystem) throw new AppError("System fees cannot be assigned here.");
    if (!toCharge.length) return { assignmentId: null, created: 0, skipped: skipped.length, total: 0 };
    const total = toCharge.reduce((t, r) => t + r.amount, 0);
    const [a] = await tx.insert(feeAssignments).values({ feeId, scope, studentCount: toCharge.length, skippedCount: skipped.length, totalAmount: total, createdBy: actor.id }).returning();
    const inserted = await tx.insert(feeCharges).values(toCharge.map((r) => ({
      feeId, studentId: r.studentId, enrolmentId: r.enrolmentId, sessionId: fee.sessionId, termId: fee.termId, classId: r.classId, armId: r.armId,
      amount: r.amount, dueDate: fee.dueDate, assignmentId: a.id, createdBy: actor.id,
    }))).onConflictDoNothing().returning({ id: feeCharges.id });
    await audit(tx, actor, { action: "fee_assigned", module: "fees", recordType: "fee", recordId: feeId, newValues: { assignmentId: a.id, scope, created: inserted.length, skipped: skipped.length, total } });
    return { assignmentId: a.id, created: inserted.length, skipped: skipped.length, total };
  });
}

/** Charge a single student a specific amount (used by imports of fee assignments / opening balances). */
export async function chargeStudentTx(tx: DBorTx, actor: Actor, feeId: number, studentId: number, amount: number) {
  const [f] = await tx.select().from(fees).where(eq(fees.id, feeId));
  const [e] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, studentId), eq(enrolments.sessionId, f.sessionId), sql`${enrolments.status} <> 'reversed'`));
  const r = await tx.insert(feeCharges).values({
    feeId, studentId, enrolmentId: e?.id ?? null, sessionId: f.sessionId, termId: f.termId, classId: e?.classId ?? null, armId: e?.armId ?? null,
    amount, dueDate: f.dueDate, createdBy: actor.id,
  }).onConflictDoNothing().returning({ id: feeCharges.id });
  return r[0]?.id ?? null;
}

/** System "Opening Balance" fee for a session (created on first use). */
export async function openingBalanceFee(tx: DBorTx, sessionId: number, actor: Actor) {
  const [ex] = await tx.select().from(fees).where(and(eq(fees.isSystem, true), eq(fees.sessionId, sessionId)));
  if (ex) return ex.id;
  let [cat] = await tx.select().from(feeCategories).where(eq(feeCategories.name, "Opening Balance"));
  if (!cat) [cat] = await tx.insert(feeCategories).values({ name: "Opening Balance" }).returning();
  const [f] = await tx.insert(fees).values({ name: "Opening Balance (migrated)", description: "Balance brought forward from the previous system", categoryId: cat.id, amount: 0,
    sessionId, isSystem: true, status: "active", mandatory: true, allowPartial: true, createdBy: actor.id }).returning();
  return f.id;
}

// ───────── Adjustments / waivers ─────────

export async function adjustCharge(actor: Actor, chargeId: number, kind: "waiver" | "discount" | "increase", amountInput: string, reason: string) {
  requirePerm(actor, "fees.adjust");
  if (!reason?.trim()) throw new ValidationError("A reason is required", { reason: "Required" });
  const amt = parseNaira(amountInput);
  if (amt === null || amt <= 0) throw new ValidationError("Enter a positive amount", { amount: "Invalid amount" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM fee_charges WHERE id = ${chargeId} FOR UPDATE`);
    const [b] = await chargeBalances({ chargeIds: [chargeId] }, tx);
    if (!b) throw new NotFoundError("Charge (or it is cancelled)");
    if (kind !== "increase" && amt > b.outstanding) throw new ValidationError(`The ${kind} cannot exceed the outstanding balance on this charge.`);
    const delta = kind === "increase" ? amt : -amt;
    const [a] = await tx.insert(feeAdjustments).values({ chargeId, kind, amount: delta, reason, createdBy: actor.id }).returning();
    await audit(tx, actor, { action: `fee_${kind}`, module: "fees", recordType: "fee_charge", recordId: chargeId, oldValues: { net: b.net, outstanding: b.outstanding }, newValues: { adjustmentId: a.id, delta }, reason });
    return a.id;
  });
}

/** Bulk waiver/discount: same amount (or percentage of outstanding) across many charges of one fee. */
export async function bulkAdjust(actor: Actor, chargeIds: number[], kind: "waiver" | "discount", amountInput: string, reason: string) {
  requirePerm(actor, "fees.adjust");
  const out = [];
  for (const id of chargeIds) out.push(await adjustCharge(actor, id, kind, amountInput, reason));
  return out.length;
}

export async function reverseAdjustment(actor: Actor, adjustmentId: number, reason: string) {
  requirePerm(actor, "fees.adjust");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(feeAdjustments).where(eq(feeAdjustments.id, adjustmentId));
    if (!a) throw new NotFoundError("Adjustment");
    if (a.reversedAt) throw new AppError("This adjustment is already reversed.");
    if (a.amount < 0) {
      // reversing a waiver increases what is owed — always allowed
    } else {
      const [b] = await chargeBalances({ chargeIds: [a.chargeId] }, tx);
      if (b && b.outstanding - a.amount < 0) throw new AppError("Reversing this increase would leave the charge overpaid.");
    }
    await tx.update(feeAdjustments).set({ reversedAt: new Date(), reversedBy: actor.id, reversalReason: reason }).where(eq(feeAdjustments.id, adjustmentId));
    await audit(tx, actor, { action: "fee_adjustment_reversed", module: "fees", recordType: "fee_adjustment", recordId: adjustmentId, reason });
  });
}

export async function cancelCharge(actor: Actor, chargeId: number, reason: string) {
  requirePerm(actor, "fees.adjust");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(feeCharges).where(eq(feeCharges.id, chargeId));
    if (!c) throw new NotFoundError("Charge");
    if (c.status !== "active") throw new AppError("This charge is already cancelled.");
    const used = await tx.select({ id: paymentAllocations.id }).from(paymentAllocations).innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(eq(paymentAllocations.chargeId, chargeId), inArray(payments.status, ["approved", "pending", "draft"])));
    if (used.length) throw new AppError("This charge has payments recorded against it and cannot be cancelled. Reverse the payments first, or apply a waiver.");
    await tx.update(feeCharges).set({ status: "cancelled", cancelledAt: new Date(), cancelledReason: reason }).where(eq(feeCharges.id, chargeId));
    await audit(tx, actor, { action: "fee_charge_cancelled", module: "fees", recordType: "fee_charge", recordId: chargeId, oldValues: c, reason });
  });
}

export async function chargeAdjustments(chargeIds: number[]) {
  if (!chargeIds.length) return [];
  return db.select().from(feeAdjustments).where(inArray(feeAdjustments.chargeId, chargeIds)).orderBy(asc(feeAdjustments.createdAt));
}
