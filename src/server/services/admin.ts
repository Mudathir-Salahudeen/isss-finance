import { db } from "@/db";
import { roles, rolePermissions, users, schoolSettings, paymentChannels, sessions } from "@/db/schema";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Actor, requirePerm } from "../actor";
import { audit } from "../audit";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashPassword, validatePasswordStrength } from "./auth";
import { parseNaira } from "@/lib/money";

// ───────── Roles ─────────

export async function listRoles() {
  const rs = await db.select().from(roles).orderBy(asc(roles.id));
  const perms = await db.select().from(rolePermissions);
  const counts = await db.select({ roleId: users.roleId, n: sql<number>`count(*)::int` }).from(users).groupBy(users.roleId);
  return rs.map((r) => ({
    ...r,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission),
    userCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
  }));
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Role name is required").max(60),
  description: z.string().trim().max(300).default(""),
  dataScope: z.enum(["all", "own"]).default("all"),
  permissions: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

export async function saveRole(actor: Actor, id: number | null, input: z.input<typeof roleSchema>) {
  requirePerm(actor, "roles.manage");
  const data = roleSchema.parse(input);
  const bad = data.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (bad.length) throw new ValidationError(`Unknown permissions: ${bad.join(", ")}`);
  return db.transaction(async (tx) => {
    const dup = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.name, data.name), id ? ne(roles.id, id) : sql`true`));
    if (dup.length) throw new ConflictError("A role with this name already exists.");
    let roleId = id;
    let old: unknown = null;
    if (id) {
      const [r] = await tx.select().from(roles).where(eq(roles.id, id));
      if (!r) throw new NotFoundError("Role");
      if (r.isSystem) {
        // The Director system role always keeps full control so the school can never lock itself out.
        data.permissions = ALL_PERMISSIONS;
        data.active = true;
      }
      const oldPerms = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, id))).map((p) => p.permission);
      old = { ...r, permissions: oldPerms };
      await tx.update(roles).set({ name: data.name, description: data.description, dataScope: data.dataScope, active: data.active }).where(eq(roles.id, id));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    } else {
      const [r] = await tx.insert(roles).values({ name: data.name, description: data.description, dataScope: data.dataScope, active: data.active }).returning();
      roleId = r.id;
    }
    if (data.permissions.length) await tx.insert(rolePermissions).values(data.permissions.map((p) => ({ roleId: roleId!, permission: p })));
    await audit(tx, actor, { action: id ? "role_updated" : "role_created", module: "admin", recordType: "role", recordId: roleId, oldValues: old, newValues: data });
    return roleId!;
  });
}

// ───────── Users ─────────

export async function listUsers() {
  return db.select({
    id: users.id, email: users.email, fullName: users.fullName, roleId: users.roleId, roleName: roles.name,
    isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
  }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).orderBy(asc(users.fullName));
}

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  fullName: z.string().trim().min(2, "Full name is required"),
  roleId: z.coerce.number().int().positive("Choose a role"),
  isActive: z.boolean().default(true),
  password: z.string().optional(),
});

export async function saveUser(actor: Actor, id: number | null, input: z.input<typeof userSchema>) {
  requirePerm(actor, "users.manage");
  const data = userSchema.parse(input);
  if (!id || data.password) {
    const weak = data.password ? validatePasswordStrength(data.password) : "A temporary password is required for a new user.";
    if (weak) throw new ValidationError(weak, { password: weak });
  }
  if (id === actor.id && !data.isActive) throw new AppError("You cannot deactivate your own account.");
  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, data.roleId));
    if (!role) throw new ValidationError("Role not found", { roleId: "Role not found" });
    const dup = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, data.email), id ? ne(users.id, id) : sql`true`));
    if (dup.length) throw new ConflictError("A user with this email already exists.");
    if (id) {
      const [old] = await tx.select().from(users).where(eq(users.id, id));
      if (!old) throw new NotFoundError("User");
      // Do not allow removing the last active Director.
      const [oldRole] = await tx.select().from(roles).where(eq(roles.id, old.roleId));
      if (oldRole.isSystem && (!data.isActive || data.roleId !== old.roleId)) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users)
          .where(and(eq(users.roleId, old.roleId), eq(users.isActive, true), ne(users.id, id)));
        if (n === 0) throw new AppError("This is the last active Director account; it cannot be deactivated or moved to another role.");
      }
      const patch: Partial<typeof users.$inferInsert> = { email: data.email, fullName: data.fullName, roleId: data.roleId, isActive: data.isActive };
      if (data.password) { patch.passwordHash = await hashPassword(data.password); patch.mustChangePassword = true; }
      await tx.update(users).set(patch).where(eq(users.id, id));
      if (!data.isActive) await tx.delete(sessions).where(eq(sessions.userId, id)); // sign out immediately
      const action = old.isActive && !data.isActive ? "user_deactivated" : !old.isActive && data.isActive ? "user_reactivated" : old.roleId !== data.roleId ? "user_role_changed" : "user_updated";
      await audit(tx, actor, {
        action, module: "admin", recordType: "user", recordId: id,
        oldValues: { email: old.email, fullName: old.fullName, roleId: old.roleId, isActive: old.isActive },
        newValues: { email: data.email, fullName: data.fullName, roleId: data.roleId, isActive: data.isActive, passwordReset: !!data.password },
      });
      return id;
    }
    const [u] = await tx.insert(users).values({
      email: data.email, fullName: data.fullName, roleId: data.roleId, isActive: data.isActive,
      passwordHash: await hashPassword(data.password!), mustChangePassword: true,
    }).returning();
    await audit(tx, actor, { action: "user_created", module: "admin", recordType: "user", recordId: u.id, newValues: { email: u.email, fullName: u.fullName, roleId: u.roleId } });
    return u.id;
  });
}

// ───────── Settings ─────────

export async function getSettings() {
  const [s] = await db.select().from(schoolSettings).where(eq(schoolSettings.id, 1));
  if (s) return s;
  const [created] = await db.insert(schoolSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schoolSettings).where(eq(schoolSettings.id, 1)))[0];
}

const settingsSchema = z.object({
  schoolName: z.string().trim().min(2),
  address: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  email: z.string().trim().default(""),
  currencySymbol: z.string().trim().min(1).max(4).default("₦"),
  dateFormat: z.enum(["dd/MM/yyyy", "dd-MM-yyyy", "dd MMM yyyy", "yyyy-MM-dd"]).default("dd/MM/yyyy"),
  receiptPrefix: z.string().trim().regex(/^[A-Z0-9-]{2,10}$/, "2–10 capital letters/digits"),
  receiptFooter: z.string().trim().max(300).default(""),
  receiptShowApprover: z.boolean(),
  allowSelfApprovalPayments: z.boolean(),
  allowSelfApprovalExpenses: z.boolean(),
  largePaymentThreshold: z.string(),
  ageingBands: z.string(),
});

export async function saveSettings(actor: Actor, input: z.input<typeof settingsSchema>) {
  requirePerm(actor, "settings.manage");
  const data = settingsSchema.parse(input);
  const threshold = parseNaira(data.largePaymentThreshold);
  if (threshold === null || threshold < 0) throw new ValidationError("Invalid large-payment threshold", { largePaymentThreshold: "Enter an amount" });
  const bands = data.ageingBands.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (!bands.length || bands.some((b, i) => i && b <= bands[i - 1])) throw new ValidationError("Ageing bands must be increasing day counts, e.g. 30,60,90");
  const old = await getSettings();
  const { largePaymentThreshold: _t, ageingBands: _a, ...rest } = data;
  void _t; void _a;
  const patch = { ...rest, largePaymentThreshold: threshold, ageingBands: bands, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    await tx.update(schoolSettings).set(patch).where(eq(schoolSettings.id, 1));
    await audit(tx, actor, { action: "settings_updated", module: "admin", recordType: "settings", recordId: 1, oldValues: old, newValues: patch });
  });
}

export async function setLogo(actor: Actor, storedName: string | null) {
  requirePerm(actor, "settings.manage");
  await db.transaction(async (tx) => {
    await tx.update(schoolSettings).set({ logoPath: storedName }).where(eq(schoolSettings.id, 1));
    await audit(tx, actor, { action: "logo_updated", module: "admin", recordType: "settings", recordId: 1, newValues: { logoPath: storedName } });
  });
}

// ───────── Payment channels ─────────

export const listChannels = () => db.select().from(paymentChannels).orderBy(asc(paymentChannels.name));

export async function saveChannel(actor: Actor, id: number | null, input: { name: string; requiresReference: boolean; requiresEvidence: boolean; active: boolean }) {
  requirePerm(actor, "settings.manage");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Channel name is required");
  return db.transaction(async (tx) => {
    if (id) await tx.update(paymentChannels).set({ ...input, name }).where(eq(paymentChannels.id, id));
    else id = (await tx.insert(paymentChannels).values({ ...input, name }).returning())[0].id;
    await audit(tx, actor, { action: "payment_channel_saved", module: "admin", recordType: "payment_channel", recordId: id, newValues: input });
    return id;
  });
}
