"use server";
import { act, str, reqNum, bool, fileOf, optNum } from "@/server/action";
import { getActor } from "@/server/session";
import { requireAny } from "@/server/actor";
import * as P from "@/server/services/payments";
import { listStudents } from "@/server/services/students";
import { chargeBalances } from "@/server/services/ledger";

export async function searchStudents(q: string) {
  const a = await getActor();
  if (!a) return [];
  requireAny(a, "payments.create", "students.view");
  if (q.trim().length < 2) return [];
  return (await listStudents({ q })).slice(0, 15).map((s) => ({ id: s.id, label: `${s.lastName}, ${s.firstName} ${s.middleName ?? ""}`.trim(), admissionNo: s.admissionNo, className: `${s.className ?? ""} ${s.armName ?? ""}`.trim(), status: s.status }));
}
export async function studentCharges(studentId: number) {
  const a = await getActor();
  if (!a) return [];
  requireAny(a, "payments.create");
  return (await chargeBalances({ studentId })).filter((c) => c.outstanding > 0).map((c) => ({
    chargeId: c.chargeId, feeName: c.feeName, sessionId: c.sessionId, sessionName: c.sessionName, termId: c.termId, termName: c.termName, dueDate: c.dueDate, outstanding: c.outstanding, pending: c.pending, allowPartial: c.allowPartial,
  }));
}

function input(fd: FormData): P.PaymentInput {
  const allocations: { chargeId: number; amount: string }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith("alloc_") && String(v).trim()) allocations.push({ chargeId: Number(k.slice(6)), amount: String(v) });
  return { studentId: reqNum(fd, "studentId"), sessionId: reqNum(fd, "sessionId"), termId: optNum(fd, "termId"), amount: str(fd, "amount"), paymentDate: str(fd, "paymentDate"),
    channelId: reqNum(fd, "channelId"), accountId: reqNum(fd, "accountId"), reference: str(fd, "reference"), payerName: str(fd, "payerName"), payerContact: str(fd, "payerContact"),
    notes: str(fd, "notes"), allocations, acknowledgeDuplicate: bool(fd, "acknowledgeDuplicate"), idempotencyKey: str(fd, "idempotencyKey") || undefined };
}
export const createPaymentAction = act(async (a, fd) => {
  const r = await P.createPayment(a, input(fd), { submit: str(fd, "intent") !== "draft", evidence: await fileOf(fd, "evidence") });
  return { redirect: `/payments/${r.id}?created=1` };
});
export const updateDraftAction = act(async (a, fd) => { await P.updateDraft(a, reqNum(fd, "id"), input(fd)); return { message: "Draft updated." }; });
export const submitDraftAction = act(async (a, fd) => { await P.submitDraft(a, reqNum(fd, "id"), bool(fd, "acknowledgeDuplicate")); return { message: "Submitted for Director approval." }; });
export const deleteDraftAction = act(async (a, fd) => { await P.deleteDraft(a, reqNum(fd, "id")); return { redirect: "/payments?status=draft" }; });
export const evidenceAction = act(async (a, fd) => { const f = await fileOf(fd, "evidence"); if (!f) return { message: "Choose a file." }; await P.addEvidence(a, reqNum(fd, "id"), f); return { message: "Evidence uploaded." }; });
export const approveAction = act(async (a, fd) => { await P.approvePayment(a, reqNum(fd, "id"), str(fd, "comment"), { acknowledgeDuplicate: bool(fd, "acknowledgeDuplicate") }); return { redirect: `/payments/${reqNum(fd, "id")}?done=approved` }; });
export const rejectAction = act(async (a, fd) => { await P.rejectPayment(a, reqNum(fd, "id"), str(fd, "reason")); return { redirect: `/payments/${reqNum(fd, "id")}?done=rejected` }; });
export const reverseAction = act(async (a, fd) => { await P.reversePayment(a, reqNum(fd, "id"), str(fd, "reason"), str(fd, "reversalDate") || undefined); return { redirect: `/payments/${reqNum(fd, "id")}?done=reversed` }; });
