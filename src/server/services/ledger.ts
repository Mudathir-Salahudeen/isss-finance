/**
 * Student ledger maths — the single source of truth for balances.
 *
 *   charge net      = charge amount + Σ active adjustments          (cancelled charges count as 0)
 *   paid            = Σ allocations of APPROVED payments only
 *   pending         = Σ allocations of PENDING payments (shown separately; never reduces balance)
 *   outstanding     = net − paid
 *
 * Every screen and report (ledger, debtors, fee collection, dashboard) reads from chargeBalances()
 * so that all totals agree with each other.
 */
import { db, DBorTx } from "@/db";
import { sql, SQL } from "drizzle-orm";

export interface ChargeBalance {
  chargeId: number; feeId: number; feeName: string; categoryId: number; categoryName: string; isSystem: boolean; mandatory: boolean; allowPartial: boolean;
  studentId: number; admissionNo: string; studentName: string; studentStatus: string;
  sessionId: number; sessionName: string; termId: number | null; termName: string | null;
  classId: number | null; className: string | null; armId: number | null; armName: string | null; levelOrder: number | null;
  dueDate: string | null; chargeStatus: string; createdAt: Date;
  amount: number; adjustments: number; net: number; paid: number; pending: number; outstanding: number;
}

export interface BalanceFilter {
  studentId?: number; studentIds?: number[]; feeId?: number; categoryId?: number; sessionId?: number; termId?: number;
  classId?: number; armId?: number; chargeIds?: number[]; includeCancelled?: boolean; asOf?: string;
}

export async function chargeBalances(f: BalanceFilter = {}, tx: DBorTx = db): Promise<ChargeBalance[]> {
  const w: SQL[] = [sql`true`];
  if (!f.includeCancelled) w.push(sql`c.status = 'active'`);
  if (f.studentId) w.push(sql`c.student_id = ${f.studentId}`);
  if (f.studentIds?.length) w.push(sql`c.student_id IN (${sql.join(f.studentIds.map((i) => sql`${i}`), sql`, `)})`);
  if (f.chargeIds?.length) w.push(sql`c.id IN (${sql.join(f.chargeIds.map((i) => sql`${i}`), sql`, `)})`);
  if (f.feeId) w.push(sql`c.fee_id = ${f.feeId}`);
  if (f.categoryId) w.push(sql`f.category_id = ${f.categoryId}`);
  if (f.sessionId) w.push(sql`c.session_id = ${f.sessionId}`);
  if (f.termId) w.push(sql`c.term_id = ${f.termId}`);
  if (f.classId) w.push(sql`c.class_id = ${f.classId}`);
  if (f.armId) w.push(sql`c.arm_id = ${f.armId}`);
  const asOfPaid = f.asOf ? sql`AND p.payment_date <= ${f.asOf}` : sql``;
  const res = await tx.execute(sql`
    WITH adj AS (
      SELECT charge_id, SUM(amount)::bigint AS amt FROM fee_adjustments WHERE reversed_at IS NULL GROUP BY charge_id
    ), alloc AS (
      SELECT a.charge_id,
        SUM(CASE WHEN p.status = 'approved' ${asOfPaid} THEN a.amount ELSE 0 END)::bigint AS paid,
        SUM(CASE WHEN p.status = 'pending' THEN a.amount ELSE 0 END)::bigint AS pending
      FROM payment_allocations a JOIN payments p ON p.id = a.payment_id GROUP BY a.charge_id
    )
    SELECT c.id AS "chargeId", c.fee_id AS "feeId", f.name AS "feeName", f.category_id AS "categoryId", fc.name AS "categoryName",
      f.is_system AS "isSystem", f.mandatory, f.allow_partial AS "allowPartial",
      s.id AS "studentId", s.admission_no AS "admissionNo",
      (s.last_name || ', ' || s.first_name || CASE WHEN COALESCE(s.middle_name,'') <> '' THEN ' ' || s.middle_name ELSE '' END) AS "studentName",
      s.status AS "studentStatus",
      c.session_id AS "sessionId", ses.name AS "sessionName", c.term_id AS "termId", t.name AS "termName",
      c.class_id AS "classId", cl.name AS "className", c.arm_id AS "armId", ar.name AS "armName", cl.level_order AS "levelOrder",
      COALESCE(c.due_date, f.due_date) AS "dueDate", c.status AS "chargeStatus", c.created_at AS "createdAt",
      c.amount::bigint AS amount,
      COALESCE(adj.amt, 0)::bigint AS adjustments,
      CASE WHEN c.status = 'active' THEN c.amount + COALESCE(adj.amt, 0) ELSE 0 END::bigint AS net,
      COALESCE(alloc.paid, 0)::bigint AS paid,
      COALESCE(alloc.pending, 0)::bigint AS pending,
      (CASE WHEN c.status = 'active' THEN c.amount + COALESCE(adj.amt, 0) ELSE 0 END - COALESCE(alloc.paid, 0))::bigint AS outstanding
    FROM fee_charges c
      JOIN fees f ON f.id = c.fee_id
      JOIN fee_categories fc ON fc.id = f.category_id
      JOIN students s ON s.id = c.student_id
      JOIN academic_sessions ses ON ses.id = c.session_id
      LEFT JOIN terms t ON t.id = c.term_id
      LEFT JOIN classes cl ON cl.id = c.class_id
      LEFT JOIN arms ar ON ar.id = c.arm_id
      LEFT JOIN adj ON adj.charge_id = c.id
      LEFT JOIN alloc ON alloc.charge_id = c.id
    WHERE ${sql.join(w, sql` AND `)}
    ORDER BY ses.name, t.seq NULLS FIRST, COALESCE(c.due_date, f.due_date) NULLS LAST, c.id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    amount: Number(r.amount), adjustments: Number(r.adjustments), net: Number(r.net), paid: Number(r.paid),
    pending: Number(r.pending), outstanding: Number(r.outstanding),
    dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
  })) as ChargeBalance[];
}

export function paymentStatusOf(net: number, paid: number, pending: number): string {
  if (net <= 0 && paid <= 0) return pending > 0 ? "pending_approval" : "paid";
  if (paid > net) return "overpaid";
  if (paid === net) return "paid";
  if (pending > 0 && paid + pending >= net) return "pending_approval";
  if (paid > 0) return "partial";
  return pending > 0 ? "pending_approval" : "unpaid";
}

export interface StudentBalance {
  studentId: number; admissionNo: string; studentName: string; studentStatus: string;
  className: string | null; armName: string | null; classId: number | null; armId: number | null; levelOrder: number | null;
  charges: number; net: number; paid: number; pending: number; outstanding: number; status: string;
  oldestOverdueDays: number | null; overdueAmount: number; chargeCount: number;
}

/** Aggregate charge balances per student (for debtors list). Class shown is the class AT THE TIME of the charge(s). */
export function aggregateByStudent(rows: ChargeBalance[], today: string): StudentBalance[] {
  const map = new Map<number, StudentBalance>();
  for (const r of rows) {
    let s = map.get(r.studentId);
    if (!s) {
      s = { studentId: r.studentId, admissionNo: r.admissionNo, studentName: r.studentName, studentStatus: r.studentStatus, className: r.className, armName: r.armName,
        classId: r.classId, armId: r.armId, levelOrder: r.levelOrder, charges: 0, net: 0, paid: 0, pending: 0, outstanding: 0, status: "", oldestOverdueDays: null, overdueAmount: 0, chargeCount: 0 };
      map.set(r.studentId, s);
    }
    s.charges += r.amount; s.net += r.net; s.paid += r.paid; s.pending += r.pending; s.outstanding += r.outstanding; s.chargeCount++;
    if (r.outstanding > 0 && r.dueDate && r.dueDate < today) {
      const days = Math.floor((Date.parse(today) - Date.parse(r.dueDate)) / 86400000);
      s.overdueAmount += r.outstanding;
      s.oldestOverdueDays = Math.max(s.oldestOverdueDays ?? 0, days);
    }
  }
  for (const s of map.values()) s.status = paymentStatusOf(s.net, s.paid, s.pending);
  return [...map.values()];
}

export function ageingBand(days: number | null, bands: number[]): string {
  if (days === null || days <= 0) return "Current";
  let lo = 1;
  for (const b of bands) {
    if (days <= b) return `${lo}–${b} days`;
    lo = b + 1;
  }
  return `Over ${bands[bands.length - 1]} days`;
}

export function ageingLabels(bands: number[]): string[] {
  const out = ["Current"];
  let lo = 1;
  for (const b of bands) { out.push(`${lo}–${b} days`); lo = b + 1; }
  out.push(`Over ${bands[bands.length - 1]} days`);
  return out;
}

export interface StatementLine { date: string; kind: string; description: string; reference: string; debit: number; credit: number; balance: number; session: string; term: string | null }

/** Chronological statement of account for one student: charges, adjustments, approved payments and reversals. */
export async function studentStatement(studentId: number, f: { sessionId?: number } = {}) {
  const sessFilter = f.sessionId ? sql`AND c.session_id = ${f.sessionId}` : sql``;
  const res = await db.execute(sql`
    SELECT * FROM (
      SELECT LEAST(c.created_at::date, COALESCE(t.start_date, c.created_at::date)) AS d, c.created_at AS ts, 'charge' AS kind,
        f.name || COALESCE(' — ' || t.name, '') AS description, '' AS reference, c.amount::bigint AS debit, 0::bigint AS credit,
        ses.name AS session, t.name AS term
      FROM fee_charges c JOIN fees f ON f.id = c.fee_id JOIN academic_sessions ses ON ses.id = c.session_id LEFT JOIN terms t ON t.id = c.term_id
      WHERE c.student_id = ${studentId} ${sessFilter}
      UNION ALL
      SELECT c.cancelled_at::date, c.cancelled_at, 'charge_cancelled', 'Cancelled: ' || f.name || ' (' || COALESCE(c.cancelled_reason,'') || ')', '', 0,
        (c.amount + COALESCE((SELECT SUM(x.amount) FROM fee_adjustments x WHERE x.charge_id = c.id AND x.reversed_at IS NULL), 0))::bigint, ses.name, t.name
      FROM fee_charges c JOIN fees f ON f.id = c.fee_id JOIN academic_sessions ses ON ses.id = c.session_id LEFT JOIN terms t ON t.id = c.term_id
      WHERE c.student_id = ${studentId} AND c.status = 'cancelled' ${sessFilter}
      UNION ALL
      SELECT a.created_at::date, a.created_at, 'adjustment', initcap(a.kind) || ': ' || f.name || ' (' || a.reason || ')', '',
        GREATEST(a.amount, 0), GREATEST(-a.amount, 0), ses.name, t.name
      FROM fee_adjustments a JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id JOIN academic_sessions ses ON ses.id = c.session_id LEFT JOIN terms t ON t.id = c.term_id
      WHERE c.student_id = ${studentId} ${sessFilter}
      UNION ALL
      SELECT a.reversed_at::date, a.reversed_at, 'adjustment_reversal', 'Reversal of ' || a.kind || ': ' || f.name, '',
        GREATEST(-a.amount, 0), GREATEST(a.amount, 0), ses.name, t.name
      FROM fee_adjustments a JOIN fee_charges c ON c.id = a.charge_id JOIN fees f ON f.id = c.fee_id JOIN academic_sessions ses ON ses.id = c.session_id LEFT JOIN terms t ON t.id = c.term_id
      WHERE c.student_id = ${studentId} AND a.reversed_at IS NOT NULL ${sessFilter}
      UNION ALL
      SELECT p.payment_date, p.decided_at, 'payment', 'Payment — ' || string_agg(f.name || ' ' || to_char(al.amount/100.0, 'FM999,999,999,990.00'), ', '),
        COALESCE(r.receipt_no, p.payment_no), 0, SUM(al.amount)::bigint, ses.name, t.name
      FROM payments p JOIN payment_allocations al ON al.payment_id = p.id JOIN fee_charges c ON c.id = al.charge_id JOIN fees f ON f.id = c.fee_id
        JOIN academic_sessions ses ON ses.id = p.session_id LEFT JOIN terms t ON t.id = p.term_id LEFT JOIN receipts r ON r.payment_id = p.id
      WHERE p.student_id = ${studentId} AND p.status IN ('approved','reversed') ${sessFilter}
      GROUP BY p.id, r.receipt_no, ses.name, t.name
      UNION ALL
      SELECT p.reversed_at::date, p.reversed_at, 'payment_reversal', 'Reversal of payment ' || p.payment_no || ' (' || COALESCE(p.reversal_reason,'') || ')',
        COALESCE(r.receipt_no, p.payment_no), SUM(al.amount)::bigint, 0, ses.name, t.name
      FROM payments p JOIN payment_allocations al ON al.payment_id = p.id JOIN fee_charges c ON c.id = al.charge_id
        JOIN academic_sessions ses ON ses.id = p.session_id LEFT JOIN terms t ON t.id = p.term_id LEFT JOIN receipts r ON r.payment_id = p.id
      WHERE p.student_id = ${studentId} AND p.status = 'reversed' ${sessFilter}
      GROUP BY p.id, r.receipt_no, ses.name, t.name
    ) x ORDER BY d, (kind NOT IN ('charge','adjustment')), ts NULLS LAST`);
  let bal = 0;
  const lines: StatementLine[] = (res.rows as Record<string, unknown>[]).map((r) => {
    const debit = Number(r.debit), credit = Number(r.credit);
    bal += debit - credit;
    return { date: String(r.d instanceof Date ? r.d.toISOString() : r.d).slice(0, 10), kind: String(r.kind), description: String(r.description), reference: String(r.reference ?? ""),
      debit, credit, balance: bal, session: String(r.session), term: (r.term as string) ?? null };
  });
  const totals = lines.reduce((t, l) => ({ debit: t.debit + l.debit, credit: t.credit + l.credit }), { debit: 0, credit: 0 });
  return { lines, totals, closing: bal };
}
