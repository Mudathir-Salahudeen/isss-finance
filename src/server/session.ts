import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { actorFromToken } from "./services/auth";
import { Actor } from "./actor";

export const SESSION_COOKIE = "sfms_session";

async function reqMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

/** Current actor or null (cached per request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const { ip, userAgent } = await reqMeta();
  const r = await actorFromToken(token, ip, userAgent);
  return r?.actor ?? null;
});

export const getSessionInfo = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const { ip, userAgent } = await reqMeta();
  return actorFromToken(token, ip, userAgent);
});

/** For pages: redirect to login if not signed in; 403 page if missing permission. */
export async function requirePage(...perms: string[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  for (const p of perms) if (!actor.permissions.has(p)) redirect(`/forbidden?perm=${encodeURIComponent(p)}`);
  return actor;
}

export { reqMeta };

/** For pages that any one of several permissions may open. */
export async function requireAnyPage(...perms: string[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!perms.some((p) => actor.permissions.has(p))) redirect(`/forbidden?perm=${encodeURIComponent(perms.join(" or "))}`);
  return actor;
}
