/**
 * Promotion / class progression. Each session has its own enrolment row per student.
 * Promotion closes the old enrolment (kept unchanged as history) and opens a new one in the next session.
 * Fee charges, payments and receipts stay attached to the session/enrolment they were raised in — nothing is moved.
 */
import { db } from "@/db";
import { enrolments, students, classes, arms, promotionEvents, academicSessions, feeCharges, users } from "@/db/schema";
import { and, asc, desc, eq, ne, sql, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { Actor, requirePerm } from "../actor";
import { audit } from "../audit";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseDateInput, todayISO } from "@/lib/dates";

export type PromotionAction = "promote" | "repeat" | "graduate" | "transfer" | "withdraw" | "skip";

export interface PreviewRow {
  studentId: number; admissionNo: string; name: string; status: string; fromEnrolmentId: number;
  fromClassId: number; fromClassName: string; fromArmId: number | null; fromArmName: string | null;
  proposedAction: PromotionAction; toClassId: number | null; toClassName: string | null; toArmId: number | null; toArmName: string | null;
  issue: string | null;
}

export async function previewPromotion(actor: Actor, fromSessionId: number, toSessionId: number, classId: number, armId?: number | null) {
  requirePerm(actor, "students.promote");
  if (fromSessionId === toSessionId) throw new ValidationError("Choose a different destination session.");
  const [from] = await db.select().from(academicSessions).where(eq(academicSessions.id, fromSessionId));
  const [to] = await db.select().from(academicSessions).where(eq(academicSessions.id, toSessionId));
  if (!from || !to) throw new NotFoundError("Session");
  if (to.name <= from.name) throw new ValidationError("The destination session must come after the current session.");
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) throw new NotFoundError("Class");
  const allClasses = await db.select().from(classes);
  const allArms = await db.select().from(arms);
  const next = cls.nextClassId ? allClasses.find((c) => c.id === cls.nextClassId) ?? null : null;
  const rows = await db.select({ e: enrolments, s: students }).from(enrolments).innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(eq(enrolments.sessionId, fromSessionId), eq(enrolments.classId, classId), ne(enrolments.status, "reversed"), armId ? eq(enrolments.armId, armId) : undefined))
    .orderBy(asc(students.lastName), asc(students.firstName));
  const already = new Set((await db.select({ s: enrolments.studentId }).from(enrolments)
    .where(and(eq(enrolments.sessionId, toSessionId), ne(enrolments.status, "reversed"), inArray(enrolments.studentId, rows.length ? rows.map((r) => r.s.id) : [0])))).map((r) => r.s));
  const out: PreviewRow[] = rows.map(({ e, s }) => {
    const fromArm = allArms.find((a) => a.id === e.armId) ?? null;
    const base = { studentId: s.id, admissionNo: s.admissionNo, name: `${s.lastName}, ${s.firstName}`, status: s.status, fromEnrolmentId: e.id,
      fromClassId: cls.id, fromClassName: cls.name, fromArmId: e.armId, fromArmName: fromArm?.name ?? null };
    if (already.has(s.id)) return { ...base, proposedAction: "skip", toClassId: null, toClassName: null, toArmId: null, toArmName: null, issue: `Already has an enrolment in ${to.name}` };
    if (s.status !== "active") return { ...base, proposedAction: "skip", toClassId: null, toClassName: null, toArmId: null, toArmName: null, issue: `Student status is ${s.status} — decide manually` };
    if (cls.isTerminal) return { ...base, proposedAction: "graduate", toClassId: null, toClassName: null, toArmId: null, toArmName: null, issue: null };
    if (!next) return { ...base, proposedAction: "skip", toClassId: null, toClassName: null, toArmId: null, toArmName: null, issue: `No next class configured for ${cls.name}` };
    const nextArms = allArms.filter((a) => a.classId === next.id && a.active);
    const sameArm = nextArms.find((a) => a.name === fromArm?.name) ?? (nextArms.length === 1 ? nextArms[0] : null);
    return { ...base, proposedAction: "promote", toClassId: next.id, toClassName: next.name, toArmId: sameArm?.id ?? null, toArmName: sameArm?.name ?? null,
      issue: nextArms.length > 1 && !sameArm ? `Choose an arm in ${next.name}` : null };
  });
  return { from, to, cls, next, rows: out, classes: allClasses.filter((c) => c.active), arms: allArms.filter((a) => a.active) };
}

export interface Decision { studentId: number; action: PromotionAction; toClassId?: number | null; toArmId?: number | null; effectiveDate?: string | null; reason?: string }

/** Execute decisions. Safe to retry: a student can never get two live enrolments in the same session (DB unique index). */
export async function executePromotion(actor: Actor, input: { fromSessionId: number; toSessionId: number; decisions: Decision[] }) {
  requirePerm(actor, "students.promote");
  const batchId = crypto.randomUUID();
  const results: { studentId: number; action: string; ok: boolean; message: string }[] = [];
  const allClasses = await db.select().from(classes);
  const allArms = await db.select().from(arms);
  for (const d of input.decisions) {
    if (d.action === "skip") { results.push({ studentId: d.studentId, action: "skip", ok: true, message: "Left for a later decision" }); continue; }
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${2000000 + d.studentId})`);
        const [s] = await tx.select().from(students).where(eq(students.id, d.studentId)).for("update");
        if (!s) throw new NotFoundError("Student");
        const [fromE] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, d.studentId), eq(enrolments.sessionId, input.fromSessionId), ne(enrolments.status, "reversed")));
        if (!fromE) throw new AppError("No enrolment in the source session.");
        const [ex] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, d.studentId), eq(enrolments.sessionId, input.toSessionId), ne(enrolments.status, "reversed")));
        if (ex) throw new AppError("Already progressed into the destination session (duplicate prevented).");
        const date = parseDateInput(d.effectiveDate) ?? todayISO();
        let toE: typeof enrolments.$inferSelect | null = null;
        let toClassId: number | null = null, toArmId: number | null = null;
        if (d.action === "promote" || d.action === "repeat") {
          if (s.status !== "active") throw new AppError(`Student is ${s.status}; only active students can be promoted or repeated.`);
          toClassId = d.action === "repeat" ? fromE.classId : d.toClassId ?? null;
          const cls = allClasses.find((c) => c.id === toClassId);
          if (!cls || !cls.active) throw new ValidationError("Destination class does not exist in the configured class structure.");
          if (d.action === "promote") {
            const fromCls = allClasses.find((c) => c.id === fromE.classId)!;
            if (fromCls.isTerminal) throw new ValidationError(`${fromCls.name} is a final class — use Graduate.`);
            if (toClassId === fromE.classId) throw new ValidationError("Promotion must move to a different class — use Repeat to stay in the same class.");
          }
          toArmId = d.action === "repeat" && d.toArmId === undefined ? fromE.armId : d.toArmId ?? null;
          if (toArmId && !allArms.find((a) => a.id === toArmId && a.classId === toClassId)) throw new ValidationError("Chosen arm does not belong to the destination class.");
          if (!toArmId && allArms.some((a) => a.classId === toClassId && a.active)) throw new ValidationError(`Choose an arm in ${cls.name}.`);
          [toE] = await tx.insert(enrolments).values({ studentId: s.id, sessionId: input.toSessionId, classId: toClassId!, armId: toArmId, isCurrent: true,
            entryType: d.action === "repeat" ? "repeated" : "promoted", createdBy: actor.id }).returning();
          await tx.update(enrolments).set({ isCurrent: false, status: "completed" }).where(eq(enrolments.id, fromE.id));
        } else {
          if (["transfer", "withdraw"].includes(d.action) && !d.reason?.trim()) throw new ValidationError("A reason is required for transfer/withdrawal.");
          const newStatus = { graduate: "graduated", transfer: "transferred", withdraw: "withdrawn" }[d.action as "graduate" | "transfer" | "withdraw"];
          await tx.update(students).set({ status: newStatus, statusDate: date, statusReason: d.reason || (d.action === "graduate" ? "Completed final class" : null), updatedAt: new Date() }).where(eq(students.id, s.id));
          await tx.update(enrolments).set({ status: "completed" }).where(eq(enrolments.id, fromE.id)); // stays current: last known placement
        }
        const actionName = ({ promote: "promoted", repeat: "repeated", graduate: "graduated", transfer: "transferred", withdraw: "withdrawn" } as Record<string, string>)[d.action];
        const [ev] = await tx.insert(promotionEvents).values({ batchId, studentId: s.id, action: actionName, fromEnrolmentId: fromE.id, toEnrolmentId: toE?.id ?? null,
          fromSessionId: fromE.sessionId, fromClassId: fromE.classId, fromArmId: fromE.armId, toSessionId: toE ? input.toSessionId : null, toClassId, toArmId,
          effectiveDate: date, performedBy: actor.id }).returning();
        await audit(tx, actor, { action: `student_${actionName}`, module: "promotion", recordType: "student", recordId: s.id,
          oldValues: { sessionId: fromE.sessionId, classId: fromE.classId, armId: fromE.armId, status: s.status }, newValues: { eventId: ev.id, toSessionId: input.toSessionId, toClassId, toArmId, batchId }, reason: d.reason ?? null });
      });
      results.push({ studentId: d.studentId, action: d.action, ok: true, message: "Done" });
    } catch (e) {
      results.push({ studentId: d.studentId, action: d.action, ok: false, message: (e as Error).message });
    }
  }
  return { batchId, results, done: results.filter((r) => r.ok && r.action !== "skip").length, failed: results.filter((r) => !r.ok).length };
}

export async function reversePromotion(actor: Actor, eventId: number, reason: string) {
  requirePerm(actor, "students.promote_reverse");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reverse a promotion.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(promotionEvents).where(eq(promotionEvents.id, eventId)).for("update");
    if (!ev) throw new NotFoundError("Promotion event");
    if (ev.reversedAt) throw new AppError("This promotion was already reversed.");
    const [later] = await tx.select().from(promotionEvents).where(and(eq(promotionEvents.studentId, ev.studentId), sql`${promotionEvents.id} > ${eventId}`, sql`${promotionEvents.reversedAt} IS NULL`));
    if (later) throw new AppError("A later progression exists for this student. Reverse that one first.");
    if (ev.toEnrolmentId) {
      const ch = await tx.select({ id: feeCharges.id }).from(feeCharges).where(and(eq(feeCharges.enrolmentId, ev.toEnrolmentId), eq(feeCharges.status, "active")));
      if (ch.length) throw new AppError(`Fees (${ch.length}) have already been charged in the new session. Cancel those charges before reversing the promotion.`);
      await tx.update(enrolments).set({ status: "reversed", isCurrent: false }).where(eq(enrolments.id, ev.toEnrolmentId));
    } else {
      await tx.update(students).set({ status: "active", statusReason: `Reversed: ${reason}`, updatedAt: new Date() }).where(eq(students.id, ev.studentId));
    }
    if (ev.fromEnrolmentId) await tx.update(enrolments).set({ status: "active", isCurrent: true }).where(eq(enrolments.id, ev.fromEnrolmentId));
    await tx.update(promotionEvents).set({ reversedAt: new Date(), reversedBy: actor.id, reversalReason: reason }).where(eq(promotionEvents.id, eventId));
    await audit(tx, actor, { action: "promotion_reversed", module: "promotion", recordType: "promotion_event", recordId: eventId, oldValues: ev, reason });
  });
}

export async function promotionHistory(f: { studentId?: number; sessionId?: number; classId?: number; action?: string } = {}) {
  const w = [sql`true`];
  if (f.studentId) w.push(sql`pe.student_id = ${f.studentId}`);
  if (f.sessionId) w.push(sql`(pe.from_session_id = ${f.sessionId} OR pe.to_session_id = ${f.sessionId})`);
  if (f.classId) w.push(sql`pe.from_class_id = ${f.classId}`);
  if (f.action) w.push(sql`pe.action = ${f.action}`);
  const r = await db.execute(sql`SELECT pe.*, s.admission_no, (s.last_name || ', ' || s.first_name) AS student_name,
      fs.name AS from_session, fc.name AS from_class, fa.name AS from_arm, ts.name AS to_session, tc.name AS to_class, ta.name AS to_arm,
      u.full_name AS performed_by_name, ru.full_name AS reversed_by_name
    FROM promotion_events pe JOIN students s ON s.id = pe.student_id
      LEFT JOIN academic_sessions fs ON fs.id = pe.from_session_id LEFT JOIN classes fc ON fc.id = pe.from_class_id LEFT JOIN arms fa ON fa.id = pe.from_arm_id
      LEFT JOIN academic_sessions ts ON ts.id = pe.to_session_id LEFT JOIN classes tc ON tc.id = pe.to_class_id LEFT JOIN arms ta ON ta.id = pe.to_arm_id
      JOIN users u ON u.id = pe.performed_by LEFT JOIN users ru ON ru.id = pe.reversed_by
    WHERE ${sql.join(w, sql` AND `)} ORDER BY pe.performed_at DESC, pe.id DESC`);
  return r.rows as Record<string, unknown>[];
}

/** Per-class counts for a session: promoted, repeated, graduated, transferred, withdrawn, awaiting decision. */
export async function promotionReport(fromSessionId: number) {
  const r = await db.execute(sql`SELECT c.id AS class_id, c.name AS class_name, c.level_order,
      COUNT(e.id)::int AS enrolled,
      COUNT(pe.id) FILTER (WHERE pe.action = 'promoted')::int AS promoted,
      COUNT(pe.id) FILTER (WHERE pe.action = 'repeated')::int AS repeated,
      COUNT(pe.id) FILTER (WHERE pe.action = 'graduated')::int AS graduated,
      COUNT(pe.id) FILTER (WHERE pe.action = 'transferred')::int AS transferred,
      COUNT(pe.id) FILTER (WHERE pe.action = 'withdrawn')::int AS withdrawn,
      COUNT(e.id) FILTER (WHERE pe.id IS NULL)::int AS awaiting
    FROM enrolments e JOIN classes c ON c.id = e.class_id
      LEFT JOIN promotion_events pe ON pe.from_enrolment_id = e.id AND pe.reversed_at IS NULL
    WHERE e.session_id = ${fromSessionId} AND e.status <> 'reversed'
    GROUP BY c.id ORDER BY c.level_order`);
  return r.rows as { class_id: number; class_name: string; enrolled: number; promoted: number; repeated: number; graduated: number; transferred: number; withdrawn: number; awaiting: number }[];
}

export { desc, users };
