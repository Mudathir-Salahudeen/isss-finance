/**
 * Student payment recording and Director approval.
 *
 * Draft → Pending Director Approval → Approved | Rejected;  Approved → Reversed.
 * Only APPROVED payments affect balances, collections, account balances and receipts.
 * All rules are enforced here on the server (and the most important ones again by DB triggers).
 */
import { db, DBorTx } from "@/db";
import { payments, paymentAllocations, receipts, receiptPrints, feeCharges, students, enrolments, paymentChannels, attachments, workflowHistory, users, accounts, academicSessions, terms, reconMatches, statementLines } from "@/db/schema";
import { and, asc, desc, eq, ne, sql, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { Actor, can, requirePerm, requireAny } from "../actor";
import { audit, notify, usersWithPermission } from "../audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatNaira, parseNaira } from "@/lib/money";
import { parseDateInput, todayISO } from "@/lib/dates";
import { chargeBalances } from "./ledger";
import { assertAccountAccess, postTxn } from "./accounts";
import { nextNumber } from "../numbering";
import { getSettings } from "./admin";
import { saveAttachment, UploadFile } from "../files";

export const paymentInputSchema = z.object({
  studentId: z.coerce.number().int().positive("Choose a student"),
  sessionId: z.coerce.number().int().positive("Choose a session"),
  termId: z.coerce.number().int().positive().nullable().optional(),
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.string().min(1, "Payment date is required"),
  channelId: z.coerce.number().int().positive("Choose a payment channel"),
  accountId: z.coerce.number().int().positive("Choose the receiving account"),
  reference: z.string().trim().max(80).default(""),
  payerName: z.string().trim().max(120).default(""),
  payerContact: z.string().trim().max(80).default(""),
  notes: z.string().trim().max(1000).default(""),
  allocations: z.array(z.object({ chargeId: z.coerce.number().int().positive(), amount: z.string() })).default([]),
  acknowledgeDuplicate: z.boolean().default(false),
  idempotencyKey: z.string().max(80).optional(),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

async function history(tx: DBorTx, actor: Actor, entityId: number, action: string, from: string | null, to: string, comment?: string | null) {
  await tx.insert(workflowHistory).values({ entityType: "payment", entityId, action, fromStatus: from, toStatus: to, actorId: actor.id, comment: comment ?? null });
}

/** Find earlier non-rejected payments with the same reference, or same student+amount+date. */
export async function findDuplicates(tx: DBorTx, p: { reference: string; studentId: number; amount: number; paymentDate: string; excludeId?: number }) {
  const conds = [];
  if (p.reference.trim()) conds.push(sql`lower(trim(${payments.reference})) = lower(trim(${p.reference}))`);
  conds.push(and(eq(payments.studentId, p.studentId), eq(payments.amount, p.amount), eq(payments.paymentDate, p.paymentDate)));
  return tx.select({ id: payments.id, paymentNo: payments.paymentNo, status: payments.status, reference: payments.reference, amount: payments.amount, studentId: payments.studentId })
    .from(payments).where(and(or(...conds), ne(payments.status, "rejected"), p.excludeId ? ne(payments.id, p.excludeId) : undefined));
}

async function validateAndBuild(tx: DBorTx, actor: Actor, input: PaymentInput, excludePaymentId?: number) {
  const d = paymentInputSchema.parse(input);
  const amount = parseNaira(d.amount);
  if (amount === null || amount <= 0) throw new ValidationError("Enter a positive amount", { amount: "Invalid amount" });
  const paymentDate = parseDateInput(d.paymentDate);
  if (!paymentDate) throw new ValidationError("Invalid payment date", { paymentDate: "Invalid date" });
  if (paymentDate > todayISO()) throw new ValidationError("Payment date cannot be in the future", { paymentDate: "Future date" });
  const [stu] = await tx.select().from(students).where(eq(students.id, d.studentId));
  if (!stu) throw new ValidationError("Student not found", { studentId: "Unknown student" });
  const [channel] = await tx.select().from(paymentChannels).where(eq(paymentChannels.id, d.channelId));
  if (!channel || !channel.active) throw new ValidationError("Invalid payment channel", { channelId: "Invalid channel" });
  if (channel.requiresReference && !d.reference) throw new ValidationError(`A transaction/teller reference is required for ${channel.name}.`, { reference: "Required for this channel" });
  await assertAccountAccess(tx, actor, d.accountId);

  if (!d.allocations.length) throw new ValidationError("Allocate the payment to at least one fee item.", { allocations: "Required" });
  const allocs: { chargeId: number; amount: number }[] = [];
  for (const a of d.allocations) {
    const v = parseNaira(a.amount);
    if (v === null || v < 0) throw new ValidationError("Invalid allocation amount", { allocations: "Invalid allocation amount" });
    if (v > 0) allocs.push({ chargeId: a.chargeId, amount: v });
  }
  if (new Set(allocs.map((a) => a.chargeId)).size !== allocs.length) throw new ValidationError("Each fee item can only be allocated once.");
  const allocTotal = allocs.reduce((t, a) => t + a.amount, 0);
  if (allocTotal !== amount) {
    throw new ValidationError(`Allocations (${formatNaira(allocTotal)}) must equal the amount received (${formatNaira(amount)}). Unapplied credit is not supported.`, { allocations: "Must equal amount" });
  }
  const balances = await chargeBalances({ chargeIds: allocs.map((a) => a.chargeId) }, tx);
  // Pending allocations from OTHER payments also reserve the charge, to stop double collection.
  const otherPending = await tx.execute(sql`SELECT a.charge_id, SUM(a.amount)::bigint AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
    WHERE p.status IN ('pending') AND a.charge_id IN (${sql.join(allocs.map((a) => sql`${a.chargeId}`), sql`, `)}) ${excludePaymentId ? sql`AND p.id <> ${excludePaymentId}` : sql``}
    GROUP BY a.charge_id`);
  for (const a of allocs) {
    const b = balances.find((x) => x.chargeId === a.chargeId);
    if (!b || b.studentId !== d.studentId) throw new ValidationError("A selected fee item does not belong to this student or is cancelled.");
    const reserved = Number((otherPending.rows as { charge_id: number; s: string }[]).find((r) => r.charge_id === a.chargeId)?.s ?? 0);
    const available = b.outstanding - reserved;
    if (a.amount > available) {
      throw new ValidationError(`${b.feeName}: allocation ${formatNaira(a.amount)} is more than the amount still open (${formatNaira(Math.max(available, 0))}${reserved ? `, after ${formatNaira(reserved)} awaiting approval` : ""}).`);
    }
    if (!b.allowPartial && a.amount !== b.outstanding) throw new ValidationError(`${b.feeName} does not allow part payment — allocate the full ${formatNaira(b.outstanding)}.`);
  }
  const [enr] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, d.studentId), eq(enrolments.sessionId, d.sessionId), ne(enrolments.status, "reversed")));
  return { d, amount, paymentDate, allocs, channel, enrolmentId: enr?.id ?? null };
}

export async function createPayment(actor: Actor, input: PaymentInput, opts: { submit: boolean; evidence?: UploadFile | null }) {
  requirePerm(actor, "payments.create");
  return db.transaction(async (tx) => {
    const { d, amount, paymentDate, allocs, channel, enrolmentId } = await validateAndBuild(tx, actor, input);
    if (d.idempotencyKey) {
      const [ex] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, d.idempotencyKey));
      if (ex) return { id: ex.id, duplicateSubmission: true, duplicates: [] };
    }
    const dups = await findDuplicates(tx, { reference: d.reference, studentId: d.studentId, amount, paymentDate });
    if (dups.length && opts.submit && !d.acknowledgeDuplicate) {
      throw new ConflictError(`Possible duplicate: ${dups.map((x) => `${x.paymentNo} (${x.status}, ref "${x.reference}", ${formatNaira(x.amount)})`).join("; ")}. Tick "I have checked this is not a duplicate" to submit anyway.`);
    }
    if (opts.submit && channel.requiresEvidence && !opts.evidence) throw new ValidationError(`Evidence (receipt/teller image or PDF) is required for ${channel.name}.`, { evidence: "Required" });
    const settings = await getSettings();
    const paymentNo = await nextNumber(tx, "PAY");
    const status = opts.submit ? "pending" : "draft";
    const [p] = await tx.insert(payments).values({
      paymentNo, studentId: d.studentId, enrolmentId, sessionId: d.sessionId, termId: d.termId ?? null, amount, paymentDate, channelId: d.channelId, accountId: d.accountId,
      reference: d.reference, payerName: d.payerName, payerContact: d.payerContact, notes: d.notes, status, recordedBy: actor.id,
      submittedAt: opts.submit ? new Date() : null, possibleDuplicateOf: dups[0]?.id ?? null, duplicateAcknowledgedBy: dups.length && d.acknowledgeDuplicate ? actor.id : null,
      isLarge: amount >= settings.largePaymentThreshold, idempotencyKey: d.idempotencyKey ?? null,
    }).returning();
    await tx.insert(paymentAllocations).values(allocs.map((a) => ({ ...a, paymentId: p.id })));
    if (opts.evidence) await saveAttachment(tx, actor, "payment", p.id, opts.evidence);
    await history(tx, actor, p.id, opts.submit ? "submitted" : "created", null, status, dups.length ? `Possible duplicate of ${dups.map((x) => x.paymentNo).join(", ")} — acknowledged by recorder` : null);
    await audit(tx, actor, { action: opts.submit ? "payment_submitted" : "payment_created", module: "payments", recordType: "payment", recordId: p.id, newValues: { ...p, allocations: allocs } });
    if (opts.submit) await notifyApprovers(tx, actor, p.id, paymentNo, amount, p.isLarge, dups.length > 0);
    return { id: p.id, duplicateSubmission: false, duplicates: dups };
  });
}

async function notifyApprovers(tx: DBorTx, actor: Actor, id: number, no: string, amount: number, large: boolean, dup: boolean) {
  const approvers = (await usersWithPermission(tx, "payments.approve")).filter((u) => u !== actor.id);
  await notify(tx, approvers, { kind: "payment_pending", title: `Payment ${no} awaiting approval`, message: `${formatNaira(amount)} recorded by ${actor.fullName}`, link: `/payments/${id}` });
  if (large) await notify(tx, approvers, { kind: "alert_large_payment", title: `Unusually large payment: ${formatNaira(amount)}`, message: `Payment ${no}`, link: `/payments/${id}` });
  if (dup) await notify(tx, approvers, { kind: "alert_duplicate", title: `Possible duplicate payment ${no}`, message: "Same reference or same student/amount/date as an earlier payment", link: `/payments/${id}` });
}

export async function updateDraft(actor: Actor, id: number, input: PaymentInput) {
  requirePerm(actor, "payments.create");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "draft") throw new AppError("Only draft payments can be edited.");
    if (p.recordedBy !== actor.id && !can(actor, "payments.approve")) throw new ForbiddenError("You can only edit your own drafts.");
    const { d, amount, paymentDate, allocs, enrolmentId } = await validateAndBuild(tx, actor, input, id);
    const patch = { studentId: d.studentId, enrolmentId, sessionId: d.sessionId, termId: d.termId ?? null, amount, paymentDate, channelId: d.channelId, accountId: d.accountId,
      reference: d.reference, payerName: d.payerName, payerContact: d.payerContact, notes: d.notes, updatedAt: new Date() };
    await tx.update(payments).set(patch).where(eq(payments.id, id));
    await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
    await tx.insert(paymentAllocations).values(allocs.map((a) => ({ ...a, paymentId: id })));
    await audit(tx, actor, { action: "payment_draft_updated", module: "payments", recordType: "payment", recordId: id, oldValues: p, newValues: { ...patch, allocations: allocs } });
  });
}

export async function addEvidence(actor: Actor, id: number, file: UploadFile) {
  requirePerm(actor, "payments.create");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id));
    if (!p) throw new NotFoundError("Payment");
    if (!["draft", "pending"].includes(p.status)) throw new AppError("Evidence can only be added before a decision is made.");
    const a = await saveAttachment(tx, actor, "payment", id, file);
    await audit(tx, actor, { action: "payment_evidence_added", module: "payments", recordType: "payment", recordId: id, newValues: { attachmentId: a.id, fileName: a.fileName } });
  });
}

export async function submitDraft(actor: Actor, id: number, acknowledgeDuplicate = false) {
  requirePerm(actor, "payments.create");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "draft") throw new AppError("Only drafts can be submitted.");
    const [ch] = await tx.select().from(paymentChannels).where(eq(paymentChannels.id, p.channelId));
    if (ch.requiresEvidence) {
      const ev = await tx.select().from(attachments).where(and(eq(attachments.entityType, "payment"), eq(attachments.entityId, id)));
      if (!ev.length) throw new ValidationError(`Evidence is required for ${ch.name} before submitting.`);
    }
    const dups = await findDuplicates(tx, { reference: p.reference ?? "", studentId: p.studentId, amount: p.amount, paymentDate: p.paymentDate, excludeId: id });
    if (dups.length && !acknowledgeDuplicate) throw new ConflictError(`Possible duplicate of ${dups.map((x) => x.paymentNo).join(", ")}. Confirm it is not a duplicate to submit.`);
    await tx.update(payments).set({ status: "pending", submittedAt: new Date(), possibleDuplicateOf: dups[0]?.id ?? p.possibleDuplicateOf, duplicateAcknowledgedBy: dups.length ? actor.id : p.duplicateAcknowledgedBy }).where(eq(payments.id, id));
    await history(tx, actor, id, "submitted", "draft", "pending");
    await audit(tx, actor, { action: "payment_submitted", module: "payments", recordType: "payment", recordId: id });
    await notifyApprovers(tx, actor, id, p.paymentNo, p.amount, p.isLarge, dups.length > 0);
  });
}

export async function deleteDraft(actor: Actor, id: number) {
  requirePerm(actor, "payments.create");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id));
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "draft") throw new AppError("Only drafts can be deleted. Submitted payments are kept for the audit trail.");
    if (p.recordedBy !== actor.id) throw new ForbiddenError("You can only delete your own drafts.");
    await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
    await tx.delete(workflowHistory).where(and(eq(workflowHistory.entityType, "payment"), eq(workflowHistory.entityId, id)));
    await tx.delete(payments).where(eq(payments.id, id));
    await audit(tx, actor, { action: "payment_draft_deleted", module: "payments", recordType: "payment", recordId: id, oldValues: p });
  });
}

/**
 * Approve: posts once to ledger, account book and receipt — all in one DB transaction with a row lock,
 * so a double click or two approvers at once can never post twice.
 */
export async function approvePayment(actor: Actor, id: number, comment = "", opts: { acknowledgeDuplicate?: boolean } = {}) {
  requirePerm(actor, "payments.approve");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status === "approved") throw new ConflictError("This payment is already approved.");
    if (p.status !== "pending") throw new AppError(`Only payments pending approval can be approved (current status: ${p.status}).`);
    const settings = await getSettings();
    if (p.recordedBy === actor.id && !settings.allowSelfApprovalPayments) {
      throw new ForbiddenError("You recorded this payment, so you cannot approve it. Another approver must review it (self-approval is disabled in policy).");
    }
    const dups = await findDuplicates(tx, { reference: p.reference ?? "", studentId: p.studentId, amount: p.amount, paymentDate: p.paymentDate, excludeId: id });
    const approvedDup = dups.filter((x) => x.status === "approved");
    if (dups.length && !opts.acknowledgeDuplicate) {
      throw new ConflictError(`Possible duplicate of ${dups.map((x) => `${x.paymentNo} (${x.status})`).join(", ")}. Review it and confirm before approving.`);
    }
    // Re-validate allocations against current balances (another payment may have been approved meanwhile).
    const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
    await tx.execute(sql`SELECT id FROM fee_charges WHERE id IN (${sql.join(allocs.map((a) => sql`${a.chargeId}`), sql`, `)}) FOR UPDATE`);
    const bal = await chargeBalances({ chargeIds: allocs.map((a) => a.chargeId) }, tx);
    for (const a of allocs) {
      const b = bal.find((x) => x.chargeId === a.chargeId);
      if (!b) throw new AppError("A fee item on this payment has been cancelled. Reject the payment and record it again.");
      if (a.amount > b.outstanding) throw new AppError(`${b.feeName}: allocation ${formatNaira(a.amount)} now exceeds the outstanding balance ${formatNaira(b.outstanding)}. Reject and re-record.`);
    }
    const now = new Date();
    await tx.update(payments).set({ status: "approved", decidedBy: actor.id, decidedAt: now, decisionComment: comment || null, updatedAt: now,
      duplicateAcknowledgedBy: dups.length ? actor.id : p.duplicateAcknowledgedBy }).where(eq(payments.id, id));
    const receiptNo = await nextNumber(tx, settings.receiptPrefix);
    const [r] = await tx.insert(receipts).values({ receiptNo, paymentId: id, issuedBy: actor.id }).returning();
    const [stu] = await tx.select().from(students).where(eq(students.id, p.studentId));
    await postTxn(tx, actor, { accountId: p.accountId, txnDate: p.paymentDate, amount: p.amount, kind: "fee_payment", sourceType: "payment", sourceId: id,
      description: `School fees — ${stu.lastName} ${stu.firstName} (${stu.admissionNo})`, reference: p.reference ?? "" });
    await history(tx, actor, id, "approved", "pending", "approved", [comment, dups.length ? `Duplicate check reviewed (${dups.map((x) => x.paymentNo).join(", ")})` : ""].filter(Boolean).join(" — ") || null);
    await audit(tx, actor, { action: "payment_approved", module: "payments", recordType: "payment", recordId: id, oldValues: { status: "pending" },
      newValues: { status: "approved", receiptNo, approvedDuplicateWarningsFor: approvedDup.map((x) => x.paymentNo) }, reason: comment || null });
    await notify(tx, [p.recordedBy], { kind: "payment_approved", title: `Payment ${p.paymentNo} approved`, message: `Receipt ${receiptNo} is ready to print.`, link: `/payments/${id}` });
    return { receiptId: r.id, receiptNo };
  });
}

export async function rejectPayment(actor: Actor, id: number, reason: string) {
  requirePerm(actor, "payments.approve");
  if (!reason?.trim()) throw new ValidationError("A rejection reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "pending") throw new AppError(`Only pending payments can be rejected (current status: ${p.status}).`);
    if (p.recordedBy === actor.id && !(await getSettings()).allowSelfApprovalPayments) throw new ForbiddenError("You cannot decide on a payment you recorded.");
    await tx.update(payments).set({ status: "rejected", decidedBy: actor.id, decidedAt: new Date(), rejectionReason: reason, updatedAt: new Date() }).where(eq(payments.id, id));
    await history(tx, actor, id, "rejected", "pending", "rejected", reason);
    await audit(tx, actor, { action: "payment_rejected", module: "payments", recordType: "payment", recordId: id, oldValues: { status: "pending" }, newValues: { status: "rejected" }, reason });
    await notify(tx, [p.recordedBy], { kind: "payment_rejected", title: `Payment ${p.paymentNo} rejected`, message: reason, link: `/payments/${id}` });
  });
}

/** Reverse an approved payment: original stays visible; a reversing book entry is posted; receipt is voided. */
export async function reversePayment(actor: Actor, id: number, reason: string, reversalDate?: string) {
  requirePerm(actor, "payments.reverse");
  if (!reason?.trim()) throw new ValidationError("A reversal reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "approved") throw new AppError("Only approved payments can be reversed.");
    const date = parseDateInput(reversalDate) ?? todayISO();
    await tx.update(payments).set({ status: "reversed", reversedBy: actor.id, reversedAt: new Date(), reversalReason: reason, updatedAt: new Date() }).where(eq(payments.id, id));
    await tx.update(receipts).set({ voided: true }).where(eq(receipts.paymentId, id));
    await postTxn(tx, actor, { accountId: p.accountId, txnDate: date, amount: -p.amount, kind: "fee_payment_reversal", sourceType: "payment", sourceId: id,
      description: `Reversal of payment ${p.paymentNo}: ${reason}`, reference: p.reference ?? "" });
    await history(tx, actor, id, "reversed", "approved", "reversed", reason);
    await audit(tx, actor, { action: "payment_reversed", module: "payments", recordType: "payment", recordId: id, oldValues: { status: "approved" }, newValues: { status: "reversed", reversalDate: date }, reason });
    await notify(tx, [p.recordedBy], { kind: "payment_reversed", title: `Payment ${p.paymentNo} reversed`, message: reason, link: `/payments/${id}` });
  });
}

// ───────── Queries ─────────

export interface PaymentFilter { q?: string; status?: string; studentId?: number; sessionId?: number; termId?: number; accountId?: number; channelId?: number; recordedBy?: number; from?: string; to?: string; classId?: number; feeId?: number; decidedFrom?: string; decidedTo?: string }

export async function listPayments(actor: Actor, f: PaymentFilter = {}) {
  requireAny(actor, "payments.view", "payments.approve");
  const w = [sql`true`];
  if (f.status) w.push(sql`p.status = ${f.status}`);
  if (f.studentId) w.push(sql`p.student_id = ${f.studentId}`);
  if (f.sessionId) w.push(sql`p.session_id = ${f.sessionId}`);
  if (f.termId) w.push(sql`p.term_id = ${f.termId}`);
  if (f.accountId) w.push(sql`p.account_id = ${f.accountId}`);
  if (f.channelId) w.push(sql`p.channel_id = ${f.channelId}`);
  if (f.recordedBy) w.push(sql`p.recorded_by = ${f.recordedBy}`);
  if (f.from) w.push(sql`p.payment_date >= ${f.from}`);
  if (f.to) w.push(sql`p.payment_date <= ${f.to}`);
  if (f.classId) w.push(sql`e.class_id = ${f.classId}`);
  if (f.feeId) w.push(sql`EXISTS (SELECT 1 FROM payment_allocations a JOIN fee_charges c ON c.id = a.charge_id WHERE a.payment_id = p.id AND c.fee_id = ${f.feeId})`);
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    w.push(sql`(p.payment_no ILIKE ${q} OR p.reference ILIKE ${q} OR s.admission_no ILIKE ${q} OR (s.first_name || ' ' || s.last_name) ILIKE ${q} OR (s.last_name || ' ' || s.first_name) ILIKE ${q} OR r.receipt_no ILIKE ${q} OR p.payer_name ILIKE ${q})`);
  }
  if (actor.dataScope === "own" && !can(actor, "payments.approve")) w.push(sql`p.recorded_by = ${actor.id}`);
  const res = await db.execute(sql`
    SELECT p.id, p.payment_no AS "paymentNo", p.status, p.amount::bigint AS amount, p.payment_date AS "paymentDate", p.reference, p.payer_name AS "payerName",
      p.recorded_at AS "recordedAt", p.submitted_at AS "submittedAt", p.decided_at AS "decidedAt", p.rejection_reason AS "rejectionReason", p.reversal_reason AS "reversalReason",
      p.is_large AS "isLarge", p.possible_duplicate_of AS "possibleDuplicateOf",
      s.id AS "studentId", s.admission_no AS "admissionNo", (s.last_name || ', ' || s.first_name) AS "studentName",
      cl.name AS "className", ses.name AS "sessionName", t.name AS "termName", ch.name AS "channelName", ac.name AS "accountName",
      ru.full_name AS "recordedByName", du.full_name AS "decidedByName", r.receipt_no AS "receiptNo",
      (SELECT count(*)::int FROM attachments x WHERE x.entity_type = 'payment' AND x.entity_id = p.id) AS "evidenceCount",
      (SELECT string_agg(f.name, ', ') FROM payment_allocations a JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id WHERE a.payment_id = p.id) AS "fees",
      EXISTS (SELECT 1 FROM recon_matches m WHERE m.active AND m.pending_payment_id = p.id) AS "bankEvidence"
    FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN enrolments e ON e.id = p.enrolment_id
      LEFT JOIN classes cl ON cl.id = e.class_id
      JOIN academic_sessions ses ON ses.id = p.session_id
      LEFT JOIN terms t ON t.id = p.term_id
      JOIN payment_channels ch ON ch.id = p.channel_id
      JOIN accounts ac ON ac.id = p.account_id
      JOIN users ru ON ru.id = p.recorded_by
      LEFT JOIN users du ON du.id = p.decided_by
      LEFT JOIN receipts r ON r.payment_id = p.id
    WHERE ${sql.join(w, sql` AND `)}
    ORDER BY p.recorded_at DESC`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({ ...r, amount: Number(r.amount), paymentDate: String(r.paymentDate).slice(0, 10) })) as PaymentRow[];
}

export interface PaymentRow {
  id: number; paymentNo: string; status: string; amount: number; paymentDate: string; reference: string; payerName: string; recordedAt: Date; submittedAt: Date | null;
  decidedAt: Date | null; rejectionReason: string | null; reversalReason: string | null; isLarge: boolean; possibleDuplicateOf: number | null; studentId: number; admissionNo: string;
  studentName: string; className: string | null; sessionName: string; termName: string | null; channelName: string; accountName: string; recordedByName: string;
  decidedByName: string | null; receiptNo: string | null; evidenceCount: number; fees: string | null; bankEvidence: boolean;
}

export async function getPayment(actor: Actor, id: number) {
  requireAny(actor, "payments.view", "payments.approve");
  const [p] = await db.select().from(payments).where(eq(payments.id, id));
  if (!p) throw new NotFoundError("Payment");
  if (actor.dataScope === "own" && !can(actor, "payments.approve") && p.recordedBy !== actor.id) throw new ForbiddenError("You can only view payments you recorded.");
  const [stu] = await db.select().from(students).where(eq(students.id, p.studentId));
  const allocs = await db.execute(sql`SELECT a.id, a.charge_id AS "chargeId", a.amount::bigint AS amount, f.name AS "feeName", t.name AS "termName", ses.name AS "sessionName", cl.name AS "className"
    FROM payment_allocations a JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id JOIN academic_sessions ses ON ses.id = c.session_id
    LEFT JOIN terms t ON t.id = c.term_id LEFT JOIN classes cl ON cl.id = c.class_id WHERE a.payment_id = ${id} ORDER BY a.id`);
  const chargeIds = (allocs.rows as { chargeId: number }[]).map((a) => a.chargeId);
  const balances = chargeIds.length ? await chargeBalances({ chargeIds, includeCancelled: true }) : [];
  const ev = await db.select().from(attachments).where(and(eq(attachments.entityType, "payment"), eq(attachments.entityId, id))).orderBy(asc(attachments.id));
  const hist = await db.select({ h: workflowHistory, by: users.fullName }).from(workflowHistory).innerJoin(users, eq(users.id, workflowHistory.actorId))
    .where(and(eq(workflowHistory.entityType, "payment"), eq(workflowHistory.entityId, id))).orderBy(asc(workflowHistory.at));
  const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentId, id));
  const prints = receipt ? await db.select({ p: receiptPrints, by: users.fullName }).from(receiptPrints).innerJoin(users, eq(users.id, receiptPrints.printedBy)).where(eq(receiptPrints.receiptId, receipt.id)).orderBy(desc(receiptPrints.printedAt)) : [];
  const [ch] = await db.select().from(paymentChannels).where(eq(paymentChannels.id, p.channelId));
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, p.accountId));
  const [ses] = await db.select().from(academicSessions).where(eq(academicSessions.id, p.sessionId));
  const [term] = p.termId ? await db.select().from(terms).where(eq(terms.id, p.termId)) : [null];
  const ids = [p.recordedBy, p.decidedBy, p.reversedBy, p.duplicateAcknowledgedBy].filter(Boolean) as number[];
  const people = ids.length ? await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
  const name = (uid: number | null) => people.find((x) => x.id === uid)?.name ?? null;
  const duplicates = await findDuplicates(db, { reference: p.reference ?? "", studentId: p.studentId, amount: p.amount, paymentDate: p.paymentDate, excludeId: id });
  const bankEvidence = await db.select({ m: reconMatches, l: statementLines }).from(reconMatches).innerJoin(statementLines, eq(statementLines.id, reconMatches.statementLineId))
    .where(and(eq(reconMatches.pendingPaymentId, id), eq(reconMatches.active, true)));
  const [enr] = p.enrolmentId ? await db.execute(sql`SELECT cl.name AS class_name, ar.name AS arm_name FROM enrolments e JOIN classes cl ON cl.id = e.class_id LEFT JOIN arms ar ON ar.id = e.arm_id WHERE e.id = ${p.enrolmentId}`).then((r) => r.rows as { class_name: string; arm_name: string | null }[]) : [];
  return {
    payment: p, student: stu, channel: ch, account: acc, session: ses, term, enrolment: enr ?? null,
    allocations: (allocs.rows as Record<string, unknown>[]).map((a) => ({ ...a, amount: Number(a.amount) })) as { id: number; chargeId: number; amount: number; feeName: string; termName: string | null; sessionName: string; className: string | null }[],
    balances, evidence: ev, history: hist.map((h) => ({ ...h.h, actorName: h.by })), receipt: receipt ?? null, prints: prints.map((x) => ({ ...x.p, byName: x.by })),
    recordedByName: name(p.recordedBy), decidedByName: name(p.decidedBy), reversedByName: name(p.reversedBy), dupAckName: name(p.duplicateAcknowledgedBy),
    duplicates, bankEvidence,
    canApprove: can(actor, "payments.approve") && p.status === "pending",
    selfRecorded: p.recordedBy === actor.id,
  };
}

/** Receipt printing: only for approved payments; every print/reprint is logged. */
export async function logReceiptPrint(actor: Actor, paymentId: number) {
  requirePerm(actor, "receipts.print");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw new NotFoundError("Payment");
    const [r] = await tx.select().from(receipts).where(eq(receipts.paymentId, paymentId)).for("update");
    if (!r || (p.status !== "approved" && p.status !== "reversed")) throw new ForbiddenError("An official receipt is only available after the Director approves the payment.");
    if (actor.dataScope === "own" && !can(actor, "payments.approve") && p.recordedBy !== actor.id) throw new ForbiddenError("You can only print receipts for payments you recorded.");
    const kind = r.printCount === 0 ? "original" : "reprint";
    await tx.update(receipts).set({ printCount: r.printCount + 1 }).where(eq(receipts.id, r.id));
    await tx.insert(receiptPrints).values({ receiptId: r.id, printedBy: actor.id, kind });
    await audit(tx, actor, { action: kind === "original" ? "receipt_printed" : "receipt_reprinted", module: "payments", recordType: "receipt", recordId: r.id, newValues: { receiptNo: r.receiptNo, printNo: r.printCount + 1 } });
    return { receipt: { ...r, printCount: r.printCount + 1 }, kind, payment: p };
  });
}

export async function pendingSummary() {
  const r = await db.execute(sql`SELECT count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS total, MIN(submitted_at) AS oldest FROM payments WHERE status = 'pending'`);
  const row = r.rows[0] as { n: number; total: string; oldest: Date | null };
  return { count: row.n, total: Number(row.total), oldest: row.oldest };
}

export { feeCharges };
