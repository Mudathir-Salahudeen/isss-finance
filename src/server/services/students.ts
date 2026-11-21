import { db, DBorTx } from "@/db";
import { students, enrolments, classes, arms, academicSessions } from "@/db/schema";
import { and, asc, eq, ilike, or, sql, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { Actor, requirePerm } from "../actor";
import { audit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseDateInput, todayISO } from "@/lib/dates";

export const STUDENT_STATUSES = ["active", "suspended", "graduated", "withdrawn", "transferred", "archived"] as const;

export const studentSchema = z.object({
  admissionNo: z.string().trim().min(1, "Admission number is required").max(40),
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().default(""),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.string().trim().default(""),
  dateOfBirth: z.string().optional().nullable(),
  guardianName: z.string().trim().default(""),
  guardianPhone: z.string().trim().default(""),
  guardianEmail: z.string().trim().default("").refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "Invalid email"),
  guardianAddress: z.string().trim().default(""),
  customFields: z.record(z.string(), z.string()).default({}),
});

/** Student rows joined with their current enrolment (class/arm/session). */
export async function listStudents(filters: { q?: string; classId?: number; armId?: number; sessionId?: number; status?: string } = {}) {
  const conds = [];
  if (filters.q) {
    const q = `%${filters.q.trim()}%`;
    conds.push(or(ilike(students.admissionNo, q), ilike(students.firstName, q), ilike(students.lastName, q), ilike(students.middleName, q),
      ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, q), ilike(students.guardianPhone, q)));
  }
  if (filters.status) conds.push(eq(students.status, filters.status));
  if (filters.classId) conds.push(eq(enrolments.classId, filters.classId));
  if (filters.armId) conds.push(eq(enrolments.armId, filters.armId));
  if (filters.sessionId) conds.push(eq(enrolments.sessionId, filters.sessionId));
  return db.select({
    id: students.id, admissionNo: students.admissionNo, firstName: students.firstName, middleName: students.middleName, lastName: students.lastName,
    gender: students.gender, status: students.status, guardianName: students.guardianName, guardianPhone: students.guardianPhone,
    enrolmentId: enrolments.id, classId: enrolments.classId, armId: enrolments.armId, sessionId: enrolments.sessionId,
    className: classes.name, armName: arms.name, sessionName: academicSessions.name, levelOrder: classes.levelOrder,
  }).from(students)
    .leftJoin(enrolments, and(eq(enrolments.studentId, students.id), eq(enrolments.isCurrent, true)))
    .leftJoin(classes, eq(classes.id, enrolments.classId))
    .leftJoin(arms, eq(arms.id, enrolments.armId))
    .leftJoin(academicSessions, eq(academicSessions.id, enrolments.sessionId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(classes.levelOrder), asc(students.lastName), asc(students.firstName));
}

export const fullName = (s: { firstName: string; middleName?: string | null; lastName: string }) =>
  [s.lastName, s.firstName, s.middleName].filter(Boolean).join(" ").replace(/^(\S+) /, "$1, ");

export async function getStudent(id: number) {
  const [s] = await db.select().from(students).where(eq(students.id, id));
  if (!s) throw new NotFoundError("Student");
  const enrols = await db.select({
    id: enrolments.id, sessionId: enrolments.sessionId, sessionName: academicSessions.name, classId: enrolments.classId, className: classes.name,
    armId: enrolments.armId, armName: arms.name, status: enrolments.status, isCurrent: enrolments.isCurrent, entryType: enrolments.entryType, createdAt: enrolments.createdAt,
  }).from(enrolments)
    .innerJoin(academicSessions, eq(academicSessions.id, enrolments.sessionId))
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .leftJoin(arms, eq(arms.id, enrolments.armId))
    .where(eq(enrolments.studentId, id)).orderBy(asc(academicSessions.name), asc(enrolments.id));
  return { student: s, enrolments: enrols, current: enrols.find((e) => e.isCurrent) ?? null };
}

async function validateClassArm(tx: DBorTx, classId: number, armId: number | null) {
  const [c] = await tx.select().from(classes).where(eq(classes.id, classId));
  if (!c) throw new ValidationError("Class does not exist", { classId: "Unknown class" });
  if (armId) {
    const [a] = await tx.select().from(arms).where(and(eq(arms.id, armId), eq(arms.classId, classId)));
    if (!a) throw new ValidationError("Arm does not belong to the selected class", { armId: "Arm not in class" });
  }
}

export async function createStudent(actor: Actor, input: z.input<typeof studentSchema> & { sessionId: number; classId: number; armId?: number | null }, tx0?: DBorTx) {
  requirePerm(actor, "students.create");
  const data = studentSchema.parse(input);
  const dob = data.dateOfBirth ? parseDateInput(data.dateOfBirth) : null;
  if (data.dateOfBirth && !dob) throw new ValidationError("Invalid date of birth", { dateOfBirth: "Use dd/mm/yyyy" });
  const run = async (tx: DBorTx) => {
    const dup = await tx.select({ id: students.id }).from(students).where(eq(students.admissionNo, data.admissionNo));
    if (dup.length) throw new ConflictError(`Admission number ${data.admissionNo} already exists.`);
    await validateClassArm(tx, input.classId, input.armId ?? null);
    const [s] = await tx.insert(students).values({ ...data, dateOfBirth: dob, createdBy: actor.id }).returning();
    const [e] = await tx.insert(enrolments).values({ studentId: s.id, sessionId: input.sessionId, classId: input.classId, armId: input.armId ?? null, createdBy: actor.id, entryType: "admitted" }).returning();
    await audit(tx, actor, { action: "student_created", module: "students", recordType: "student", recordId: s.id, newValues: { ...data, enrolment: e } });
    return s.id;
  };
  return tx0 ? run(tx0) : db.transaction(run);
}

export async function updateStudent(actor: Actor, id: number, input: z.input<typeof studentSchema>) {
  requirePerm(actor, "students.edit");
  const data = studentSchema.parse(input);
  const dob = data.dateOfBirth ? parseDateInput(data.dateOfBirth) : null;
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(students).where(eq(students.id, id));
    if (!old) throw new NotFoundError("Student");
    const dup = await tx.select({ id: students.id }).from(students).where(and(eq(students.admissionNo, data.admissionNo), ne(students.id, id)));
    if (dup.length) throw new ConflictError(`Admission number ${data.admissionNo} already belongs to another student.`);
    await tx.update(students).set({ ...data, dateOfBirth: dob, updatedAt: new Date() }).where(eq(students.id, id));
    await audit(tx, actor, { action: "student_updated", module: "students", recordType: "student", recordId: id, oldValues: old, newValues: data });
  });
}

/** Change placement within the CURRENT session (e.g. correct arm). History in prior sessions is untouched. */
export async function changeCurrentPlacement(actor: Actor, studentId: number, classId: number, armId: number | null, reason: string) {
  requirePerm(actor, "students.edit");
  if (!reason?.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(enrolments).where(and(eq(enrolments.studentId, studentId), eq(enrolments.isCurrent, true)));
    if (!e) throw new NotFoundError("Current enrolment");
    await validateClassArm(tx, classId, armId);
    await tx.update(enrolments).set({ classId, armId }).where(eq(enrolments.id, e.id));
    await audit(tx, actor, { action: "placement_changed", module: "students", recordType: "enrolment", recordId: e.id, oldValues: { classId: e.classId, armId: e.armId }, newValues: { classId, armId }, reason });
  });
}

export async function changeStatus(actor: Actor, id: number, status: string, effectiveDate: string | null, reason: string) {
  requirePerm(actor, "students.edit");
  if (!STUDENT_STATUSES.includes(status as (typeof STUDENT_STATUSES)[number])) throw new ValidationError("Invalid status");
  if (status !== "active" && !reason?.trim()) throw new ValidationError("A reason is required for this status change", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(students).where(eq(students.id, id));
    if (!old) throw new NotFoundError("Student");
    const date = parseDateInput(effectiveDate) ?? todayISO();
    await tx.update(students).set({ status, statusDate: date, statusReason: reason || null, updatedAt: new Date() }).where(eq(students.id, id));
    await audit(tx, actor, { action: "student_status_changed", module: "students", recordType: "student", recordId: id, oldValues: { status: old.status }, newValues: { status, effectiveDate: date }, reason });
  });
}

export async function studentsByIds(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(students).where(inArray(students.id, ids));
}
