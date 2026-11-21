"use server";
import { act, str, optNum, reqNum, bool } from "@/server/action";
import * as AC from "@/server/services/accounts";

export const accountAction = act(async (a, fd) => {
  const id = await AC.saveAccount(a, optNum(fd, "id"), { name: str(fd, "name"), provider: str(fd, "provider"), accountNumber: str(fd, "accountNumber"), type: str(fd, "type") as "bank",
    currency: "NGN", openingBalance: str(fd, "openingBalance") || "0", openingDate: str(fd, "openingDate") || null, active: fd.get("active") !== "0", restricted: bool(fd, "restricted"),
    custodianUserId: optNum(fd, "custodianUserId"), userIds: fd.getAll("userIds").map(Number).filter(Boolean) });
  return { redirect: `/accounts/${id}` };
});
export const transferAction = act(async (a, fd) => { await AC.createTransfer(a, { fromAccountId: reqNum(fd, "fromAccountId"), toAccountId: reqNum(fd, "toAccountId"), amount: str(fd, "amount"), transferDate: str(fd, "transferDate"), reference: str(fd, "reference"), notes: str(fd, "notes") }); return { message: "Transfer recorded." }; });
export const reverseTransferAction = act(async (a, fd) => { await AC.reverseTransfer(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Transfer reversed." }; });
