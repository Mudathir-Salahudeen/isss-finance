"use server";
import { act, str, reqNum } from "@/server/action";
import { getActor } from "@/server/session";
import { requirePerm } from "@/server/actor";
import * as R from "@/server/services/recon";
import { readSpreadsheet } from "@/lib/spreadsheet";
import { AppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";

export async function previewStatement(fd: FormData) {
  const a = await getActor();
  if (!a) return { error: "Not signed in" };
  try {
    requirePerm(a, "recon.manage");
    const f = fd.get("file");
    if (!f || typeof f === "string" || !f.size) throw new AppError("Choose a statement file.");
    const sheet = await readSpreadsheet(Buffer.from(await f.arrayBuffer()), f.name);
    const mapping = fd.get("mapping") ? JSON.parse(String(fd.get("mapping"))) : R.suggestStatementMapping(sheet.headers);
    let rows: ReturnType<typeof R.parseStatementRows> = [];
    try { rows = R.parseStatementRows(sheet, mapping); } catch { /* mapping incomplete */ }
    if (fd.get("commit") === "1") {
      const r = await R.importStatement(a, Number(fd.get("accountId")), f.name, sheet, mapping);
      revalidatePath("/", "layout");
      return { committed: r };
    }
    return { headers: sheet.headers, mapping, rows: rows.slice(0, 200), total: rows.length, errors: rows.filter((r) => r.error).length };
  } catch (e) { return { error: e instanceof AppError ? e.message : "Could not read the statement." }; }
}
export const autoMatchAction = act(async (a, fd) => { const r = await R.autoMatch(a, reqNum(fd, "accountId"), { from: str(fd, "from") || undefined, to: str(fd, "to") || undefined }); return { message: `${r.matched} line(s) matched automatically; ${r.evidence} linked to pending payments as evidence; ${r.unmatched} still unmatched.` }; });
export const manualMatchAction = act(async (a, fd) => { await R.manualMatch(a, reqNum(fd, "lineId"), reqNum(fd, "accountTxnId"), str(fd, "note")); return { message: "Matched." }; });
export const unmatchAction = act(async (a, fd) => { await R.unmatch(a, reqNum(fd, "lineId"), str(fd, "reason")); return { message: "Unmatched." }; });
export const categoriseAction = act(async (a, fd) => { await R.categoriseLine(a, reqNum(fd, "lineId"), str(fd, "kind") as "bank_charge", str(fd, "categoryName"), str(fd, "reason")); return { message: "Recorded in the book and matched." }; });
export const ignoreAction = act(async (a, fd) => { await R.ignoreLine(a, reqNum(fd, "lineId"), str(fd, "reason")); return { message: "Line ignored." }; });
export const startRecAction = act(async (a, fd) => { const id = await R.startReconciliation(a, { accountId: reqNum(fd, "accountId"), periodStart: str(fd, "periodStart"), periodEnd: str(fd, "periodEnd"), statementBalance: str(fd, "statementBalance"), notes: str(fd, "notes") }); return { redirect: `/reconciliation/${id}` }; });
export const refreshRecAction = act(async (a, fd) => { await R.refreshReconciliation(a, reqNum(fd, "id"), str(fd, "statementBalance") || undefined); return { message: "Balances recalculated." }; });
export const completeRecAction = act(async (a, fd) => { await R.completeReconciliation(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Period reconciled and locked." }; });
export const reopenRecAction = act(async (a, fd) => { await R.reopenReconciliation(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Reconciliation reopened." }; });
