import { db } from "@/db";
import { users, roles, rolePermissions, sessions, loginAttempts } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Actor } from "../actor";
import { audit } from "../audit";
import { AppError } from "@/lib/errors";

const MAX_FAILED = 5;
const WINDOW_MIN = 15;

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export function validatePasswordStrength(p: string): string | null {
  if (p.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password must contain letters and numbers.";
  return null;
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export async function login(email: string, password: string, ip: string | null, userAgent: string | null) {
  email = email.trim().toLowerCase();
  // Rate limit: too many failures for this email or IP in the window → block.
  const since = new Date(Date.now() - WINDOW_MIN * 60000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.at, since)));
  const [{ nip }] = ip ? await db.select({ nip: sql<number>`count(*)::int` }).from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.at, since))) : [{ nip: 0 }];
  if (n >= MAX_FAILED || nip >= MAX_FAILED * 4) {
    throw new AppError(`Too many failed sign-in attempts. Try again in ${WINDOW_MIN} minutes.`, 429);
  }
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const ok = u && u.isActive && (await bcrypt.compare(password, u.passwordHash));
  await db.insert(loginAttempts).values({ email, ip, success: !!ok });
  if (!ok) {
    await audit(db, null, { action: "login_failed", module: "auth", recordType: "user", recordId: u?.id ?? null, newValues: { email, reason: u && !u.isActive ? "inactive" : "bad_credentials" } });
    throw new AppError("Invalid email or password.", 401);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const hours = Number(process.env.SESSION_HOURS || 12);
  await db.insert(sessions).values({ id: sha(token), userId: u.id, expiresAt: new Date(Date.now() + hours * 3600000), ip, userAgent });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const actor = await actorForUser(u.id, ip, userAgent);
  await audit(db, actor, { action: "login", module: "auth", recordType: "user", recordId: u.id });
  return { token, expiresHours: hours, mustChangePassword: u.mustChangePassword };
}

export async function actorForUser(userId: number, ip?: string | null, userAgent?: string | null): Promise<Actor | null> {
  const [row] = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId));
  if (!row || !row.u.isActive) return null;
  const perms = row.r.active ? await db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, row.r.id)) : [];
  return {
    id: row.u.id, fullName: row.u.fullName, email: row.u.email, roleId: row.r.id, roleName: row.r.name,
    dataScope: row.r.dataScope === "own" ? "own" : "all", permissions: new Set(perms.map((p) => p.p)), ip, userAgent,
  };
}

export async function actorFromToken(token: string | undefined, ip?: string | null, userAgent?: string | null) {
  if (!token) return null;
  const [s] = await db.select().from(sessions).where(and(eq(sessions.id, sha(token)), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  const actor = await actorForUser(s.userId, ip, userAgent);
  return actor ? { actor, mustChangePassword: (await db.select({ m: users.mustChangePassword }).from(users).where(eq(users.id, s.userId)))[0]?.m } : null;
}

export async function logout(token: string | undefined, actor: Actor | null) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, sha(token)));
  if (actor) await audit(db, actor, { action: "logout", module: "auth", recordType: "user", recordId: actor.id });
}

export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  const [u] = await db.select().from(users).where(eq(users.id, actor.id));
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new AppError("Current password is incorrect.");
  const weak = validatePasswordStrength(next);
  if (weak) throw new AppError(weak);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, actor.id));
    await audit(tx, actor, { action: "password_changed", module: "auth", recordType: "user", recordId: actor.id });
  });
}
