/** Base data every installation needs: settings row, default roles, payment channels and categories. Idempotent. */
import { db } from "@/db";
import { roles, rolePermissions, schoolSettings, paymentChannels, feeCategories, expenseCategories, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_ROLES, ALL_PERMISSIONS } from "@/lib/permissions";
import { DEFAULT_EXPENSE_CATEGORIES } from "./services/expenses";
import { hashPassword, validatePasswordStrength } from "./services/auth";
import { audit } from "./audit";
import { storeFile } from "./files";
import fs from "node:fs/promises";
import path from "node:path";

export const SCHOOL_NAME = process.env.SCHOOL_NAME || "IBN Salahudeen Science School (ISSS)";

export const DEFAULT_CHANNELS = [
  { name: "Bank Transfer", requiresReference: true, requiresEvidence: true },
  { name: "Cash", requiresReference: false, requiresEvidence: false },
  { name: "POS", requiresReference: true, requiresEvidence: false },
  { name: "Cheque", requiresReference: true, requiresEvidence: true },
  { name: "Bank Deposit (Teller)", requiresReference: true, requiresEvidence: true },
];

export const DEFAULT_FEE_CATEGORIES = ["Tuition", "Registration", "Examination", "PTA Levy", "Cultural Day", "Graduation", "Excursion", "Sports", "ICT",
  "Development Levy", "School Bus / Transport", "Uniform", "Books", "End-of-Year Party", "Special Projects", "Other Fees"];

export async function setupBase() {
  const created = await db.insert(schoolSettings).values({ id: 1, schoolName: SCHOOL_NAME }).onConflictDoNothing().returning();
  if (created.length) {
    // First run: install the bundled school logo (can be replaced in School settings).
    try {
      const bytes = await fs.readFile(path.resolve(process.cwd(), "assets/logo-isss.png"));
      const stored = await storeFile({ name: "logo.png", type: "image/png", bytes }, { images: true });
      await db.update(schoolSettings).set({ logoPath: stored }).where(eq(schoolSettings.id, 1));
    } catch { /* logo is optional */ }
  }
  for (const r of DEFAULT_ROLES) {
    const [ex] = await db.select().from(roles).where(eq(roles.name, r.name));
    if (ex) {
      if (ex.isSystem) { // Director always has every permission, including ones added in later versions
        await db.insert(rolePermissions).values(ALL_PERMISSIONS.map((p) => ({ roleId: ex.id, permission: p }))).onConflictDoNothing();
      }
      continue;
    }
    const [created] = await db.insert(roles).values({ name: r.name, description: r.description, isSystem: !!r.isSystem, dataScope: r.dataScope ?? "all" }).returning();
    await db.insert(rolePermissions).values(r.perms.map((p) => ({ roleId: created.id, permission: p }))).onConflictDoNothing();
  }
  for (const c of DEFAULT_CHANNELS) await db.insert(paymentChannels).values(c).onConflictDoNothing();
  for (const c of DEFAULT_FEE_CATEGORIES) await db.insert(feeCategories).values({ name: c }).onConflictDoNothing();
  const existing = (await db.select().from(expenseCategories)).map((c) => c.name);
  for (const c of DEFAULT_EXPENSE_CATEGORIES) if (!existing.includes(c)) await db.insert(expenseCategories).values({ name: c });
}

/** Creates the first Director if no users exist. Password must be supplied (never a default). */
export async function createFirstDirector(email: string, fullName: string, password: string) {
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(weak);
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM users`)).rows as { n: number }[];
  if (n > 0) return null;
  const [dir] = await db.select().from(roles).where(eq(roles.isSystem, true));
  const [u] = await db.insert(users).values({ email: email.toLowerCase(), fullName, passwordHash: await hashPassword(password), roleId: dir.id, mustChangePassword: true }).returning();
  await audit(db, null, { action: "bootstrap_director_created", module: "admin", recordType: "user", recordId: u.id, newValues: { email: u.email } });
  return u.id;
}
