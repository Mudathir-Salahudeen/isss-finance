"use server";
import { act, str, optNum, reqNum, bool } from "@/server/action";
import * as F from "@/server/services/fees";

function feeInput(fd: FormData) {
  const classAmounts: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("class_") && String(v).trim()) classAmounts[k.slice(6)] = String(v);
  return { name: str(fd, "name"), description: str(fd, "description"), categoryId: reqNum(fd, "categoryId"), amount: str(fd, "amount"), sessionId: reqNum(fd, "sessionId"), termId: optNum(fd, "termId"),
    mandatory: bool(fd, "mandatory"), dueDate: str(fd, "dueDate") || null, allowPartial: bool(fd, "allowPartial"), recurring: bool(fd, "recurring"), frequency: str(fd, "frequency") || null,
    status: (str(fd, "status") || "draft") as "draft", classAmounts };
}
export const createFeeAction = act(async (a, fd) => { const id = await F.createFee(a, feeInput(fd)); return { redirect: `/fees/${id}` }; });
export const updateFeeAction = act(async (a, fd) => { await F.updateFee(a, reqNum(fd, "id"), feeInput(fd)); return { message: "Fee updated." }; });
export const feeStatusAction = act(async (a, fd) => {
  const r = await F.setFeeStatus(a, reqNum(fd, "id"), str(fd, "status") as "active", str(fd, "reason"), bool(fd, "cancelUnpaid"));
  return { message: `Status changed.${r.cancelledCharges ? ` ${r.cancelledCharges} unpaid charge(s) cancelled.` : ""}` };
});
export const categoryAction = act(async (a, fd) => { await F.saveFeeCategory(a, optNum(fd, "id"), str(fd, "name")); return { message: "Category saved." }; });

export const assignAction = act(async (a, fd) => {
  const r = await F.assignFee(a, reqNum(fd, "id"), JSON.parse(str(fd, "scope")));
  return { redirect: `/fees/${reqNum(fd, "id")}?assigned=${r.created}&skipped=${r.skipped}` };
});
