import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getActor } from "./session";
import { Actor } from "./actor";
import { AppError } from "@/lib/errors";

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; data?: unknown; at?: number } | null;

/**
 * Wrap a server action: authenticates, converts domain errors into form messages, then redirects/revalidates.
 * Permission checks happen inside the service functions (server-side), never only in the UI.
 */
export function act(fn: (actor: Actor, fd: FormData) => Promise<{ message?: string; redirect?: string; data?: unknown } | void>) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    const actor = await getActor();
    if (!actor) redirect("/login");
    let res: { message?: string; redirect?: string; data?: unknown } | void;
    try {
      res = await fn(actor, fd);
    } catch (e) {
      if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors, at: Date.now() };
      if (e instanceof ZodError) {
        const fe: Record<string, string> = {};
        for (const i of e.issues) fe[i.path.join(".")] = i.message;
        return { error: e.issues[0]?.message ?? "Please check the form.", fieldErrors: fe, at: Date.now() };
      }
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
      console.error(e);
      return { error: "Something went wrong. The action was not completed.", at: Date.now() };
    }
    if (res?.redirect) redirect(res.redirect);
    revalidatePath("/", "layout");
    return { ok: true, message: res?.message ?? "Saved.", data: res?.data, at: Date.now() };
  };
}

export const str = (fd: FormData, k: string) => (fd.get(k) as string | null)?.toString().trim() ?? "";
export const optNum = (fd: FormData, k: string) => { const v = str(fd, k); return v && /^\d+$/.test(v) ? Number(v) : null; };
export const reqNum = (fd: FormData, k: string) => Number(str(fd, k)) || 0;
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1" || fd.get(k) === "true";
export async function fileOf(fd: FormData, k: string) {
  const f = fd.get(k);
  if (!f || typeof f === "string" || f.size === 0) return null;
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}
