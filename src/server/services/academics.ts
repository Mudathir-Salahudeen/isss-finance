import { db } from "@/db";
import { academicSessions, terms, classes, arms } from "@/db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { Actor, requirePerm } from "../actor";
import { audit } from "../audit";
import { ConflictError, ValidationError } from "@/lib/errors";
import { parseDateInput } from "@/lib/dates";

export const listSessions = () => db.select().from(academicSessions).orderBy(asc(academicSessions.name));
export const listTerms = () => db.select().from(terms).orderBy(asc(terms.sessionId), asc(terms.seq));
export const listClasses = () => db.select().from(classes).orderBy(asc(classes.levelOrder));
export const listArms = () => db.select().from(arms).orderBy(asc(arms.classId), asc(arms.name));

export async function currentSession() {
  const [s] = await db.select().from(academicSessions).where(eq(academicSessions.isCurrent, true));
  return s ?? null;
}
export async function currentTerm() {
  const [t] = await db.select().from(terms).where(eq(terms.isCurrent, true));
  return t ?? null;
}

export async function getStructure() {
  const [s, t, c, a] = await Promise.all([listSessions(), listTerms(), listClasses(), listArms()]);
  return { sessions: s, terms: t, classes: c, arms: a };
}

export async function saveSession(actor: Actor, id: number | null, input: { name: string; startDate?: string; endDate?: string; isCurrent: boolean }) {
  requirePerm(actor, "academics.manage");
  const name = input.name.trim();
  if (!/^\d{4}\/\d{4}$/.test(name)) throw new ValidationError("Session name must look like 2025/2026", { name: "Format: 2025/2026" });
  const startDate = parseDateInput(input.startDate) ;
  const endDate = parseDateInput(input.endDate);
  if (startDate && endDate && endDate <= startDate) throw new ValidationError("End date must be after start date");
  return db.transaction(async (tx) => {
    const dup = await tx.select().from(academicSessions).where(and(eq(academicSessions.name, name), id ? ne(academicSessions.id, id) : undefined));
    if (dup.length) throw new ConflictError("This academic session already exists.");
    if (input.isCurrent) await tx.update(academicSessions).set({ isCurrent: false });
    const values = { name, startDate, endDate, isCurrent: input.isCurrent };
    if (id) await tx.update(academicSessions).set(values).where(eq(academicSessions.id, id));
    else id = (await tx.insert(academicSessions).values(values).returning())[0].id;
    await audit(tx, actor, { action: "session_saved", module: "academics", recordType: "academic_session", recordId: id, newValues: values });
    return id;
  });
}

export async function saveTerm(actor: Actor, id: number | null, input: { sessionId: number; name: string; seq: number; startDate?: string; endDate?: string; isCurrent: boolean }) {
  requirePerm(actor, "academics.manage");
  if (!input.name.trim()) throw new ValidationError("Term name is required");
  if (!Number.isInteger(input.seq) || input.seq < 1 || input.seq > 6) throw new ValidationError("Term order must be 1–6");
  return db.transaction(async (tx) => {
    const dup = await tx.select().from(terms).where(and(eq(terms.sessionId, input.sessionId), eq(terms.seq, input.seq), id ? ne(terms.id, id) : undefined));
    if (dup.length) throw new ConflictError("That session already has a term with this order number.");
    if (input.isCurrent) {
      await tx.update(terms).set({ isCurrent: false });
      await tx.update(academicSessions).set({ isCurrent: false });
      await tx.update(academicSessions).set({ isCurrent: true }).where(eq(academicSessions.id, input.sessionId));
    }
    const values = { sessionId: input.sessionId, name: input.name.trim(), seq: input.seq, startDate: parseDateInput(input.startDate), endDate: parseDateInput(input.endDate), isCurrent: input.isCurrent };
    if (id) await tx.update(terms).set(values).where(eq(terms.id, id));
    else id = (await tx.insert(terms).values(values).returning())[0].id;
    await audit(tx, actor, { action: "term_saved", module: "academics", recordType: "term", recordId: id, newValues: values });
    return id;
  });
}

export async function saveClass(actor: Actor, id: number | null, input: { name: string; levelOrder: number; nextClassId: number | null; isTerminal: boolean; active: boolean }) {
  requirePerm(actor, "academics.manage");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Class name is required");
  if (input.nextClassId && input.isTerminal) throw new ValidationError("A final (graduating) class cannot have a next class.");
  if (id && input.nextClassId === id) throw new ValidationError("A class cannot progress into itself.");
  return db.transaction(async (tx) => {
    const dup = await tx.select().from(classes).where(and(eq(classes.name, name), id ? ne(classes.id, id) : undefined));
    if (dup.length) throw new ConflictError("A class with this name already exists.");
    if (input.nextClassId) {
      const [nx] = await tx.select().from(classes).where(eq(classes.id, input.nextClassId));
      if (!nx) throw new ValidationError("Next class does not exist.");
    }
    const values = { name, levelOrder: input.levelOrder, nextClassId: input.nextClassId, isTerminal: input.isTerminal, active: input.active };
    if (id) await tx.update(classes).set(values).where(eq(classes.id, id));
    else id = (await tx.insert(classes).values(values).returning())[0].id;
    await audit(tx, actor, { action: "class_saved", module: "academics", recordType: "class", recordId: id, newValues: values });
    return id;
  });
}

export async function saveArm(actor: Actor, id: number | null, input: { classId: number; name: string; active: boolean }) {
  requirePerm(actor, "academics.manage");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Arm name is required");
  return db.transaction(async (tx) => {
    const dup = await tx.select().from(arms).where(and(eq(arms.classId, input.classId), eq(arms.name, name), id ? ne(arms.id, id) : undefined));
    if (dup.length) throw new ConflictError("This class already has an arm with that name.");
    const values = { classId: input.classId, name, active: input.active };
    if (id) await tx.update(arms).set(values).where(eq(arms.id, id));
    else id = (await tx.insert(arms).values(values).returning())[0].id;
    await audit(tx, actor, { action: "arm_saved", module: "academics", recordType: "arm", recordId: id, newValues: values });
    return id;
  });
}
