import { DBorTx } from "@/db";
import { auditEvents, notifications, users, rolePermissions } from "@/db/schema";
import { Actor } from "./actor";
import { and, eq, inArray } from "drizzle-orm";

export interface AuditInput {
  action: string;
  module: string;
  recordType?: string;
  recordId?: string | number | null;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
}

/** Append an audit event. Must be called inside the same transaction as the change it describes. */
export async function audit(tx: DBorTx, actor: Actor | null, e: AuditInput) {
  await tx.insert(auditEvents).values({
    userId: actor?.id ?? null,
    userName: actor?.fullName ?? "system",
    action: e.action,
    module: e.module,
    recordType: e.recordType ?? null,
    recordId: e.recordId === undefined || e.recordId === null ? null : String(e.recordId),
    oldValues: e.oldValues === undefined ? null : (e.oldValues as object),
    newValues: e.newValues === undefined ? null : (e.newValues as object),
    reason: e.reason ?? null,
    ip: actor?.ip ?? null,
    userAgent: actor?.userAgent ?? null,
  });
}

export async function notify(tx: DBorTx, userIds: number[], n: { kind: string; title: string; message?: string; link?: string }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  await tx.insert(notifications).values(ids.map((userId) => ({ userId, kind: n.kind, title: n.title, message: n.message ?? "", link: n.link ?? null })));
}

/** All active users who hold a given permission (e.g. approvers to notify). */
export async function usersWithPermission(tx: DBorTx, perm: string): Promise<number[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
    .where(and(eq(rolePermissions.permission, perm), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

export { inArray };
