/**
 * Bulk import: upload → preview headers → map columns (saveable profiles) → validate (dry run) → commit → summary.
 * Never silently overwrites: existing records are skipped unless "update existing" is chosen AND the user holds
 * the update permission; even then, blank cells never overwrite existing values.
 */
import { db, DBorTx } from "@/db";
import { importBatches, importMappings, importStaging, students, enrolments, classes, arms, fees, staff, academicSessions } from "@/db/schema";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { Actor, can, requirePerm } from "../actor";
import { audit, notify } from "../audit";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { readSpreadsheet, Sheet } from "@/lib/spreadsheet";
import { parseDateInput } from "@/lib/dates";
import { parseNaira } from "@/lib/money";
import { chargeStudentTx, openingBalanceFee } from "./fees";

export type ImportKind = "students" | "staff" | "fee_assignments" | "opening_balances";
export interface FieldDef { key: string; label: string; required: boolean; aliases: string[]; example?: string }

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  students: [
    { key: "admissionNo", label: "Admission number", required: true, aliases: ["admission no", "admission number", "adm no", "admno", "student id", "reg no", "id"], example: "ADM/2025/001" },
    { key: "firstName", label: "First name", required: true, aliases: ["first name", "firstname", "given name", "first"], example: "Chiamaka" },
    { key: "middleName", label: "Middle name", required: false, aliases: ["middle name", "middlename", "other name", "other names"], example: "Grace" },
    { key: "lastName", label: "Last name / surname", required: true, aliases: ["last name", "lastname", "surname", "family name"], example: "Okafor" },
    { key: "gender", label: "Gender", required: false, aliases: ["gender", "sex"], example: "Female" },
    { key: "dateOfBirth", label: "Date of birth", required: false, aliases: ["date of birth", "dob", "birth date", "birthday"], example: "14/03/2014" },
    { key: "className", label: "Class", required: true, aliases: ["class", "class name", "level", "grade"], example: "JSS 1" },
    { key: "armName", label: "Arm / stream", required: false, aliases: ["arm", "stream", "section", "class arm"], example: "A" },
    { key: "guardianName", label: "Parent/guardian name", required: false, aliases: ["guardian", "guardian name", "parent", "parent name", "parent/guardian"], example: "Mrs. Ngozi Okafor" },
    { key: "guardianPhone", label: "Guardian phone", required: false, aliases: ["phone", "guardian phone", "parent phone", "phone number", "mobile"], example: "08031234567" },
    { key: "guardianEmail", label: "Guardian email", required: false, aliases: ["email", "guardian email", "parent email"], example: "ngozi@example.com" },
    { key: "guardianAddress", label: "Address", required: false, aliases: ["address", "home address", "guardian address"], example: "12 Allen Avenue, Ikeja" },
  ],
  staff: [
    { key: "staffNo", label: "Staff ID", required: true, aliases: ["staff id", "staff no", "staff number", "employee id", "id"], example: "STF-001" },
    { key: "fullName", label: "Full name", required: true, aliases: ["full name", "name", "staff name"], example: "Adewale Johnson" },
    { key: "department", label: "Department", required: false, aliases: ["department", "dept"], example: "Academics" },
    { key: "position", label: "Position", required: false, aliases: ["position", "role", "designation", "title"], example: "Mathematics Teacher" },
    { key: "startDate", label: "Start date", required: false, aliases: ["start date", "employment date", "date employed"], example: "05/09/2022" },
    { key: "salaryType", label: "Salary type", required: false, aliases: ["salary type", "pay type"], example: "monthly" },
    { key: "basic", label: "Basic salary (₦)", required: false, aliases: ["basic", "basic salary", "salary", "monthly salary"], example: "150000" },
    { key: "bankName", label: "Bank", required: false, aliases: ["bank", "bank name"], example: "GTBank" },
    { key: "bankAccountNumber", label: "Account number", required: false, aliases: ["account number", "account no", "nuban"], example: "0123456789" },
    { key: "bankAccountName", label: "Account name", required: false, aliases: ["account name"], example: "Adewale Johnson" },
    { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile"], example: "08021234567" },
    { key: "email", label: "Email", required: false, aliases: ["email"], example: "a.johnson@school.ng" },
  ],
  fee_assignments: [
    { key: "admissionNo", label: "Admission number", required: true, aliases: ["admission no", "admission number", "adm no", "student id"], example: "ADM/2025/001" },
    { key: "feeName", label: "Fee name (as set up in Fees)", required: true, aliases: ["fee", "fee name", "fee type", "item"], example: "Bus Fee" },
    { key: "amount", label: "Amount (₦, optional — overrides fee amount)", required: false, aliases: ["amount", "fee amount"], example: "45000" },
  ],
  opening_balances: [
    { key: "admissionNo", label: "Admission number", required: true, aliases: ["admission no", "admission number", "adm no", "student id"], example: "ADM/2025/001" },
    { key: "amount", label: "Outstanding balance brought forward (₦)", required: true, aliases: ["amount", "balance", "outstanding", "opening balance", "arrears"], example: "35000" },
  ],
};


export function suggestMapping(kind: ImportKind, headers: string[], saved?: Record<string, string>) {
  const m: Record<string, string> = {};
  for (const f of IMPORT_FIELDS[kind]) {
    if (saved?.[f.key] && headers.includes(saved[f.key])) { m[f.key] = saved[f.key]; continue; }
    const h = headers.find((x) => f.aliases.includes(x.trim().toLowerCase()) || x.trim().toLowerCase() === f.label.toLowerCase());
    if (h) m[f.key] = h;
  }
  return m;
}

function permFor(kind: ImportKind) {
  return { students: "students.import", staff: "payroll.manage_staff", fee_assignments: "fees.assign", opening_balances: "fees.opening_balance" }[kind];
}

/** Step 1: parse the uploaded file and keep it server-side under a random token. */
export async function stageImport(actor: Actor, kind: ImportKind, fileName: string, buf: Buffer) {
  requirePerm(actor, permFor(kind));
  if (buf.length > 4 * 1024 * 1024) throw new ValidationError("Import files are limited to 4 MB. Split larger files, or save as .csv.");
  const sheet = await readSpreadsheet(buf, fileName);
  if (sheet.rows.length > 20000) throw new ValidationError("Too many rows (max 20,000 per import). Split the file.");
  const token = crypto.randomBytes(16).toString("hex");
  await db.execute(sql`DELETE FROM import_staging WHERE created_at < now() - interval '1 day'`);
  await db.insert(importStaging).values({ token, userId: actor.id, kind, fileName, sheet });
  const profiles = await db.select().from(importMappings).where(eq(importMappings.kind, kind));
  return { token, fileName, headers: sheet.headers, sample: sheet.rows.slice(0, 8), rowCount: sheet.rows.length, mapping: suggestMapping(kind, sheet.headers), profiles };
}

async function loadStaged(actor: Actor, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new ValidationError("Invalid import token");
  const [j] = await db.select().from(importStaging).where(eq(importStaging.token, token));
  if (!j) throw new AppError("The uploaded file has expired. Upload it again.", 410);
  if (j.userId !== actor.id) throw new AppError("This import belongs to another user.", 403);
  return { kind: j.kind as ImportKind, fileName: j.fileName, userId: j.userId, sheet: j.sheet as Sheet };
}

export async function saveMappingProfile(actor: Actor, kind: ImportKind, name: string, mapping: Record<string, string>) {
  requirePerm(actor, permFor(kind));
  if (!name.trim()) throw new ValidationError("Give the mapping profile a name");
  await db.insert(importMappings).values({ kind, name: name.trim(), mapping, createdBy: actor.id })
    .onConflictDoUpdate({ target: [importMappings.kind, importMappings.name], set: { mapping } });
}

export interface RowResult { row: number; outcome: "create" | "update" | "skip" | "error"; message: string; warnings: string[]; data: Record<string, string> }
export interface ImportOptions { sessionId?: number; updateExisting?: boolean; skipPossibleDuplicates?: boolean }

function rowData(sheet: Sheet, mapping: Record<string, string>, r: (string | number | null)[]) {
  const d: Record<string, string> = {};
  for (const [k, h] of Object.entries(mapping)) {
    const i = sheet.headers.indexOf(h);
    if (i >= 0) d[k] = r[i] === null || r[i] === undefined ? "" : String(r[i]).trim();
  }
  return d;
}

async function analyse(tx: DBorTx, actor: Actor, kind: ImportKind, sheet: Sheet, mapping: Record<string, string>, opts: ImportOptions): Promise<RowResult[]> {
  const fields = IMPORT_FIELDS[kind];
  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  if (missing.length) throw new ValidationError(`Map the required columns: ${missing.map((f) => f.label).join(", ")}`);
  if ((kind === "students" || kind === "opening_balances" || kind === "fee_assignments") && !opts.sessionId) throw new ValidationError("Choose the academic session for this import.");
  if (opts.updateExisting && kind === "students" && !can(actor, "students.import_update")) throw new AppError("You do not have permission to update existing students via import.", 403);
  const out: RowResult[] = [];
  const seen = new Map<string, number>();

  if (kind === "students") {
    const cls = await tx.select().from(classes);
    const ar = await tx.select().from(arms);
    const existing = new Map((await tx.select({ id: students.id, a: students.admissionNo }).from(students)).map((s) => [s.a.toLowerCase(), s.id]));
    const names = await tx.select({ id: students.id, f: students.firstName, l: students.lastName, dob: students.dateOfBirth, a: students.admissionNo }).from(students);
    sheet.rows.forEach((r, i) => {
      const d = rowData(sheet, mapping, r);
      const errs: string[] = [], warns: string[] = [];
      for (const f of fields) if (f.required && !d[f.key]) errs.push(`${f.label} is required`);
      const c = cls.find((x) => x.name.toLowerCase().replace(/\s+/g, "") === (d.className ?? "").toLowerCase().replace(/\s+/g, ""));
      if (d.className && !c) errs.push(`Unknown class "${d.className}"`);
      if (c && d.armName && !ar.find((a) => a.classId === c.id && a.name.toLowerCase() === d.armName.toLowerCase())) errs.push(`Arm "${d.armName}" does not exist in ${c.name}`);
      if (d.dateOfBirth && !parseDateInput(d.dateOfBirth)) errs.push(`Invalid date of birth "${d.dateOfBirth}"`);
      if (d.guardianEmail && !/^\S+@\S+\.\S+$/.test(d.guardianEmail)) errs.push("Invalid guardian email");
      const key = (d.admissionNo ?? "").toLowerCase();
      if (key && seen.has(key)) errs.push(`Duplicate admission number in file (also row ${seen.get(key)})`);
      if (key) seen.set(key, i + 2);
      let outcome: RowResult["outcome"] = "create";
      if (existing.has(key)) {
        outcome = opts.updateExisting ? "update" : "skip";
        if (!opts.updateExisting) warns.push("Admission number already exists — skipped (enable 'update existing' to update)");
      } else {
        const dob = parseDateInput(d.dateOfBirth);
        const sim = names.filter((n) => n.f.toLowerCase() === (d.firstName ?? "").toLowerCase() && n.l.toLowerCase() === (d.lastName ?? "").toLowerCase() && (!dob || !n.dob || n.dob === dob));
        if (sim.length) {
          warns.push(`Possible duplicate of existing student ${sim.map((s) => s.a).join(", ")} (same name${dob ? " and DOB" : ""})`);
          if (opts.skipPossibleDuplicates) outcome = "skip";
        }
      }
      out.push({ row: i + 2, outcome: errs.length ? "error" : outcome, message: errs.join("; ") || (outcome === "skip" ? warns.join("; ") : outcome === "update" ? "Will update non-blank fields" : "Will be created"), warnings: warns, data: d });
    });
  }

  if (kind === "staff") {
    const existing = new Map((await tx.select({ id: staff.id, n: staff.staffNo }).from(staff)).map((s) => [s.n.toLowerCase(), s.id]));
    sheet.rows.forEach((r, i) => {
      const d = rowData(sheet, mapping, r);
      const errs: string[] = [];
      for (const f of fields) if (f.required && !d[f.key]) errs.push(`${f.label} is required`);
      if (d.basic && (parseNaira(d.basic) === null || parseNaira(d.basic)! < 0)) errs.push(`Invalid basic salary "${d.basic}"`);
      if (d.startDate && !parseDateInput(d.startDate)) errs.push("Invalid start date");
      if (d.salaryType && !["monthly", "daily", "contract"].includes(d.salaryType.toLowerCase())) errs.push("Salary type must be monthly, daily or contract");
      if (d.bankAccountNumber && !/^\d{10}$/.test(d.bankAccountNumber)) errs.push("Account number must be 10 digits (NUBAN)");
      const key = (d.staffNo ?? "").toLowerCase();
      if (key && seen.has(key)) errs.push(`Duplicate staff ID in file (row ${seen.get(key)})`);
      if (key) seen.set(key, i + 2);
      const exists = existing.has(key);
      out.push({ row: i + 2, outcome: errs.length ? "error" : exists ? "skip" : "create", message: errs.join("; ") || (exists ? "Staff ID already exists — skipped" : "Will be created"), warnings: [], data: d });
    });
  }

  if (kind === "fee_assignments" || kind === "opening_balances") {
    const studs = new Map((await tx.select({ id: students.id, a: students.admissionNo, st: students.status }).from(students)).map((s) => [s.a.toLowerCase(), s]));
    const sessFees = kind === "fee_assignments" ? await tx.select().from(fees).where(and(eq(fees.sessionId, opts.sessionId!), eq(fees.isSystem, false))) : [];
    const enrolled = new Set((await tx.select({ s: enrolments.studentId }).from(enrolments).where(and(eq(enrolments.sessionId, opts.sessionId!), ne(enrolments.status, "reversed")))).map((e) => e.s));
    const existingCharges = new Set((await tx.execute(sql`SELECT fee_id || ':' || student_id AS k FROM fee_charges`)).rows.map((r) => (r as { k: string }).k));
    const obFee = kind === "opening_balances" ? (await tx.select().from(fees).where(and(eq(fees.isSystem, true), eq(fees.sessionId, opts.sessionId!))))[0] : null;
    sheet.rows.forEach((r, i) => {
      const d = rowData(sheet, mapping, r);
      const errs: string[] = [], warns: string[] = [];
      for (const f of fields) if (f.required && !d[f.key]) errs.push(`${f.label} is required`);
      const s = studs.get((d.admissionNo ?? "").toLowerCase());
      if (d.admissionNo && !s) errs.push(`No student with admission number "${d.admissionNo}"`);
      if (s && !enrolled.has(s.id)) warns.push("Student has no enrolment in this session — class will be blank on the charge");
      if (d.amount && (parseNaira(d.amount) === null || parseNaira(d.amount)! <= 0)) errs.push(`Amount must be a positive number ("${d.amount}")`);
      let outcome: RowResult["outcome"] = "create";
      if (kind === "fee_assignments") {
        const f = sessFees.find((x) => x.name.toLowerCase() === (d.feeName ?? "").toLowerCase());
        if (d.feeName && !f) errs.push(`No fee named "${d.feeName}" in the selected session`);
        else if (f && f.status !== "active") errs.push(`Fee "${f.name}" is ${f.status}`);
        if (f && s && existingCharges.has(`${f.id}:${s.id}`)) { outcome = "skip"; warns.push("Already assigned — skipped"); }
        const k = `${d.feeName}|${d.admissionNo}`.toLowerCase();
        if (seen.has(k)) errs.push(`Duplicate row (also row ${seen.get(k)})`);
        seen.set(k, i + 2);
      } else {
        if (obFee && s && existingCharges.has(`${obFee.id}:${s.id}`)) { outcome = "skip"; warns.push("Opening balance already recorded for this student/session — skipped"); }
        const k = (d.admissionNo ?? "").toLowerCase();
        if (seen.has(k)) errs.push(`Duplicate admission number in file (row ${seen.get(k)})`);
        seen.set(k, i + 2);
      }
      out.push({ row: i + 2, outcome: errs.length ? "error" : outcome, message: errs.join("; ") || (outcome === "skip" ? warns.join("; ") : "Will be charged"), warnings: warns, data: d });
    });
  }
  return out;
}

export async function validateImport(actor: Actor, token: string, mapping: Record<string, string>, opts: ImportOptions) {
  const j = await loadStaged(actor, token);
  requirePerm(actor, permFor(j.kind));
  const rows = await analyse(db, actor, j.kind, j.sheet, mapping, opts);
  return summarise(rows);
}

function summarise(rows: RowResult[]) {
  return {
    rows,
    counts: { total: rows.length, create: rows.filter((r) => r.outcome === "create").length, update: rows.filter((r) => r.outcome === "update").length,
      skip: rows.filter((r) => r.outcome === "skip").length, error: rows.filter((r) => r.outcome === "error").length, warnings: rows.filter((r) => r.warnings.length).length },
  };
}

/** Commit valid rows in one transaction; failed rows are recorded with their errors for download. */
export async function commitImport(actor: Actor, token: string, mapping: Record<string, string>, opts: ImportOptions) {
  const j = await loadStaged(actor, token);
  requirePerm(actor, permFor(j.kind));
  const batchId = await db.transaction(async (tx) => {
    const rows = await analyse(tx, actor, j.kind, j.sheet, mapping, opts);
    const results: { row: number; outcome: string; message: string; data: Record<string, string> }[] = [];
    let created = 0, updated = 0;
    const cls = await tx.select().from(classes);
    const ar = await tx.select().from(arms);
    for (const r of rows) {
      if (r.outcome === "error" || r.outcome === "skip") { results.push({ row: r.row, outcome: r.outcome === "error" ? "failed" : "skipped", message: r.message, data: r.data }); continue; }
      const d = r.data;
      if (j.kind === "students") {
        const c = cls.find((x) => x.name.toLowerCase().replace(/\s+/g, "") === d.className.toLowerCase().replace(/\s+/g, ""))!;
        const a = d.armName ? ar.find((x) => x.classId === c.id && x.name.toLowerCase() === d.armName.toLowerCase()) : null;
        const fieldsPatch = { firstName: d.firstName, middleName: d.middleName ?? "", lastName: d.lastName, gender: d.gender ?? "", dateOfBirth: parseDateInput(d.dateOfBirth),
          guardianName: d.guardianName ?? "", guardianPhone: d.guardianPhone ?? "", guardianEmail: d.guardianEmail ?? "", guardianAddress: d.guardianAddress ?? "" };
        if (r.outcome === "create") {
          const [s] = await tx.insert(students).values({ admissionNo: d.admissionNo, ...fieldsPatch, createdBy: actor.id }).returning();
          await tx.insert(enrolments).values({ studentId: s.id, sessionId: opts.sessionId!, classId: c.id, armId: a?.id ?? null, createdBy: actor.id, entryType: "imported" });
          created++;
        } else {
          const [s] = await tx.select().from(students).where(sql`lower(${students.admissionNo}) = ${d.admissionNo.toLowerCase()}`);
          const patch = Object.fromEntries(Object.entries(fieldsPatch).filter(([, v]) => v !== "" && v !== null && v !== undefined));
          await tx.update(students).set({ ...patch, updatedAt: new Date() }).where(eq(students.id, s.id));
          const [e] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, s.id), eq(enrolments.sessionId, opts.sessionId!), ne(enrolments.status, "reversed")));
          if (!e) {
            await tx.update(enrolments).set({ isCurrent: false }).where(eq(enrolments.studentId, s.id));
            await tx.insert(enrolments).values({ studentId: s.id, sessionId: opts.sessionId!, classId: c.id, armId: a?.id ?? null, createdBy: actor.id, entryType: "imported" });
          }
          await audit(tx, actor, { action: "student_updated_by_import", module: "students", recordType: "student", recordId: s.id, oldValues: s, newValues: patch });
          updated++;
        }
      } else if (j.kind === "staff") {
        await saveStaffRow(tx, actor, d);
        created++;
      } else if (j.kind === "fee_assignments") {
        const [f] = await tx.select().from(fees).where(and(eq(fees.sessionId, opts.sessionId!), sql`lower(${fees.name}) = ${d.feeName.toLowerCase()}`, eq(fees.isSystem, false)));
        const [s] = await tx.select().from(students).where(sql`lower(${students.admissionNo}) = ${d.admissionNo.toLowerCase()}`);
        const id = await chargeStudentTx(tx, actor, f.id, s.id, d.amount ? parseNaira(d.amount)! : f.amount);
        if (id) created++;
      } else if (j.kind === "opening_balances") {
        const feeId = await openingBalanceFee(tx, opts.sessionId!, actor);
        const [s] = await tx.select().from(students).where(sql`lower(${students.admissionNo}) = ${d.admissionNo.toLowerCase()}`);
        const id = await chargeStudentTx(tx, actor, feeId, s.id, parseNaira(d.amount)!);
        if (id) created++;
      }
      results.push({ row: r.row, outcome: r.outcome === "update" ? "updated" : "imported", message: r.warnings.join("; ") || "OK", data: d });
    }
    const failed = results.filter((x) => x.outcome === "failed").length;
    const skipped = results.filter((x) => x.outcome === "skipped").length;
    const [b] = await tx.insert(importBatches).values({ kind: j.kind, fileName: j.fileName, uploadedBy: actor.id, totalRows: rows.length, createdCount: created, updatedCount: updated,
      skippedCount: skipped, failedCount: failed, status: failed ? "completed_with_errors" : "completed", rowResults: results }).returning();
    await audit(tx, actor, { action: "import_committed", module: j.kind === "staff" ? "payroll" : j.kind === "students" ? "students" : "fees", recordType: "import_batch", recordId: b.id,
      newValues: { kind: j.kind, fileName: j.fileName, rows: rows.length, created, updated, skipped, failed, sessionId: opts.sessionId } });
    if (failed) await notify(tx, [actor.id], { kind: "import_failed_rows", title: `Import "${j.fileName}": ${failed} row(s) failed`, message: "Download the failed rows, fix them and re-import.", link: `/imports/${b.id}` });
    return b.id;
  });
  await db.delete(importStaging).where(eq(importStaging.token, token));
  return batchId;
}

async function saveStaffRow(tx: DBorTx, actor: Actor, d: Record<string, string>) {
  const { saveStaff } = await import("./payroll");
  await saveStaff(actor, null, {
    staffNo: d.staffNo, fullName: d.fullName, department: d.department ?? "", position: d.position ?? "", startDate: d.startDate || null,
    salaryType: ((d.salaryType || "monthly").toLowerCase() as "monthly"), bankName: d.bankName ?? "", bankAccountNumber: d.bankAccountNumber ?? "",
    bankAccountName: d.bankAccountName ?? "", phone: d.phone ?? "", email: d.email ?? "", basic: d.basic || undefined, reason: "Imported",
  }, tx);
}

export async function listImportBatches(actor: Actor) {
  if (!["students.import", "payroll.manage_staff", "fees.assign", "fees.opening_balance", "audit.view"].some((p) => can(actor, p))) throw new AppError("Forbidden", 403);
  return db.execute(sql`SELECT b.id, b.kind, b.file_name, b.created_at, b.total_rows, b.created_count, b.updated_count, b.skipped_count, b.failed_count, b.status, u.full_name AS uploaded_by
    FROM import_batches b JOIN users u ON u.id = b.uploaded_by ORDER BY b.created_at DESC LIMIT 200`).then((r) => r.rows as Record<string, unknown>[]);
}

export async function getImportBatch(actor: Actor, id: number) {
  const [b] = await db.select().from(importBatches).where(eq(importBatches.id, id));
  if (!b) throw new NotFoundError("Import");
  if (b.uploadedBy !== actor.id && !can(actor, "audit.view")) requirePerm(actor, permFor(b.kind as ImportKind));
  return b;
}

export function templateColumns(kind: ImportKind) {
  return IMPORT_FIELDS[kind].map((f) => ({ key: f.key, label: f.label.replace(/ \(.*\)$/, "") + (f.required ? " *" : ""), example: f.example ?? "" }));
}

export { desc, academicSessions };
