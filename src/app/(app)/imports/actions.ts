"use server";
import { getActor } from "@/server/session";
import * as I from "@/server/services/imports";
import { AppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";

async function wrap<T>(fn: (a: NonNullable<Awaited<ReturnType<typeof getActor>>>) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const a = await getActor();
  if (!a) return { ok: false, error: "Not signed in" };
  try { return { ok: true, data: await fn(a) }; } catch (e) { if (e instanceof AppError) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Unexpected error while processing the file." }; }
}

export async function stageAction(fd: FormData) {
  return wrap(async (a) => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || !f.size) throw new AppError("Choose a file to upload.");
    return I.stageImport(a, String(fd.get("kind")) as I.ImportKind, f.name, Buffer.from(await f.arrayBuffer()));
  });
}
export async function validateAction(token: string, mapping: Record<string, string>, opts: I.ImportOptions) { return wrap((a) => I.validateImport(a, token, mapping, opts)); }
export async function commitAction(token: string, mapping: Record<string, string>, opts: I.ImportOptions) {
  const r = await wrap((a) => I.commitImport(a, token, mapping, opts));
  revalidatePath("/", "layout");
  return r;
}
export async function saveProfileAction(kind: I.ImportKind, name: string, mapping: Record<string, string>) { return wrap((a) => I.saveMappingProfile(a, kind, name, mapping)); }
