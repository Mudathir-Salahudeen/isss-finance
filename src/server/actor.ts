import { ForbiddenError } from "@/lib/errors";

/** The authenticated user performing an action. Built from the DB on every request. */
export interface Actor {
  id: number;
  fullName: string;
  email: string;
  roleId: number;
  roleName: string;
  dataScope: "all" | "own";
  permissions: Set<string>;
  ip?: string | null;
  userAgent?: string | null;
}

export function can(actor: Actor, perm: string): boolean {
  return actor.permissions.has(perm);
}

/** Server-side permission enforcement. Every service function calls this before doing work. */
export function requirePerm(actor: Actor, ...perms: string[]): void {
  for (const p of perms) {
    if (!actor.permissions.has(p)) throw new ForbiddenError(`Permission required: ${p}`);
  }
}

export function requireAny(actor: Actor, ...perms: string[]): void {
  if (!perms.some((p) => actor.permissions.has(p))) throw new ForbiddenError(`One of these permissions is required: ${perms.join(", ")}`);
}
