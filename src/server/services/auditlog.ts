import { db } from "@/db";
import { auditEvents, notifications } from "@/db/schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { Actor, can, requirePerm } from "../actor";
import { audit } from "../audit";

export interface AuditFilter { from?: string; to?: string; userId?: number; module?: string; action?: string; recordType?: string; recordId?: string; q?: string }

export async function listAudit(actor: Actor, f: AuditFilter, limit = 5000) {
  requirePerm(actor, "audit.view");
  const c = [];
  if (f.from) c.push(gte(auditEvents.at, new Date(`${f.from}T00:00:00+01:00`)));
  if (f.to) c.push(lte(auditEvents.at, new Date(`${f.to}T23:59:59.999+01:00`)));
  if (f.userId) c.push(eq(auditEvents.userId, f.userId));
  if (f.module) c.push(eq(auditEvents.module, f.module));
  if (f.action) c.push(ilike(auditEvents.action, `%${f.action}%`));
  if (f.recordType) c.push(eq(auditEvents.recordType, f.recordType));
  if (f.recordId) c.push(eq(auditEvents.recordId, f.recordId));
  if (f.q) c.push(or(ilike(auditEvents.action, `%${f.q}%`), ilike(auditEvents.userName, `%${f.q}%`), ilike(auditEvents.reason, `%${f.q}%`),
    sql`${auditEvents.newValues}::text ILIKE ${"%" + f.q + "%"}`, sql`${auditEvents.oldValues}::text ILIKE ${"%" + f.q + "%"}`));
  return db.select().from(auditEvents).where(c.length ? and(...c) : undefined).orderBy(desc(auditEvents.at), desc(auditEvents.id)).limit(limit);
}

export async function auditModules() {
  const r = await db.execute(sql`SELECT DISTINCT module FROM audit_events ORDER BY 1`);
  return (r.rows as { module: string }[]).map((x) => x.module);
}

export async function recordHistory(recordType: string, recordId: string | number) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.recordType, recordType), eq(auditEvents.recordId, String(recordId)))).orderBy(desc(auditEvents.at));
}

/** Exports are logged; sensitive ones require reports.export_sensitive. */
export async function logExport(actor: Actor, report: string, format: string, rowCount: number, filters: unknown, sensitive: boolean) {
  requirePerm(actor, "reports.export");
  if (sensitive) requirePerm(actor, "reports.export_sensitive");
  await audit(db, actor, { action: "export", module: "reports", recordType: "report", recordId: report, newValues: { format, rowCount, filters, sensitive } });
}

// ───────── Notifications ─────────
export const myNotifications = (actor: Actor, limit = 100) => db.select().from(notifications).where(eq(notifications.userId, actor.id)).orderBy(desc(notifications.createdAt)).limit(limit);
export async function unreadCount(actor: Actor) {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${actor.id} AND NOT is_read`);
  return (r.rows[0] as { n: number }).n;
}
export async function markRead(actor: Actor, id?: number) {
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, actor.id), id ? eq(notifications.id, id) : undefined));
}

// ───────── Global search ─────────
export async function globalSearch(actor: Actor, q: string) {
  q = q.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const out: { type: string; label: string; sub: string; href: string }[] = [];
  if (can(actor, "students.view")) {
    const r = await db.execute(sql`SELECT id, admission_no, first_name, last_name, status FROM students WHERE admission_no ILIKE ${like} OR (first_name || ' ' || last_name) ILIKE ${like}
      OR (last_name || ' ' || first_name) ILIKE ${like} OR guardian_phone ILIKE ${like} LIMIT 10`);
    for (const s of r.rows as Record<string, string>[]) out.push({ type: "Student", label: `${s.last_name}, ${s.first_name}`, sub: `${s.admission_no} · ${s.status}`, href: `/students/${s.id}` });
  }
  if (can(actor, "payments.view") || can(actor, "payments.approve")) {
    const own = actor.dataScope === "own" && !can(actor, "payments.approve") ? sql`AND p.recorded_by = ${actor.id}` : sql``;
    const r = await db.execute(sql`SELECT p.id, p.payment_no, p.reference, p.status, r.receipt_no, s.last_name, s.first_name FROM payments p JOIN students s ON s.id = p.student_id
      LEFT JOIN receipts r ON r.payment_id = p.id WHERE (p.payment_no ILIKE ${like} OR p.reference ILIKE ${like} OR r.receipt_no ILIKE ${like}) ${own} LIMIT 10`);
    for (const p of r.rows as Record<string, string>[]) out.push({ type: p.receipt_no && p.receipt_no.toLowerCase().includes(q.toLowerCase()) ? "Receipt" : "Payment", label: p.receipt_no ?? p.payment_no, sub: `${p.last_name}, ${p.first_name} · ref ${p.reference || "—"} · ${p.status}`, href: `/payments/${p.id}` });
  }
  if (can(actor, "expenses.view") || can(actor, "expenses.approve")) {
    const r = await db.execute(sql`SELECT e.id, e.expense_no, e.title, e.status FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE e.expense_no ILIKE ${like} OR e.title ILIKE ${like} OR e.payee_name ILIKE ${like} OR v.name ILIKE ${like} OR e.paid_reference ILIKE ${like} LIMIT 10`);
    for (const e of r.rows as Record<string, string>[]) out.push({ type: "Expense", label: e.expense_no, sub: `${e.title} · ${e.status}`, href: `/expenses/${e.id}` });
  }
  if (can(actor, "payroll.view")) {
    const r = await db.execute(sql`SELECT id, staff_no, full_name, position FROM staff WHERE staff_no ILIKE ${like} OR full_name ILIKE ${like} LIMIT 10`);
    for (const s of r.rows as Record<string, string>[]) out.push({ type: "Staff", label: s.full_name, sub: `${s.staff_no} · ${s.position}`, href: `/payroll/staff/${s.id}` });
  }
  return out;
}
