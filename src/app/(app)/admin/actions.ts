"use server";
import { act, str, optNum, reqNum, bool, fileOf } from "@/server/action";
import * as Ad from "@/server/services/admin";
import { storeFile } from "@/server/files";
import { requirePerm } from "@/server/actor";
import { changeOwnPassword } from "@/server/services/auth";
import { markRead } from "@/server/services/auditlog";
import { ValidationError } from "@/lib/errors";

export const userAction = act(async (a, fd) => {
  await Ad.saveUser(a, optNum(fd, "id"), { email: str(fd, "email"), fullName: str(fd, "fullName"), roleId: reqNum(fd, "roleId"), isActive: fd.get("isActive") !== "0", password: str(fd, "password") || undefined });
  return { message: "User saved." };
});
export const roleAction = act(async (a, fd) => {
  const id = await Ad.saveRole(a, optNum(fd, "id"), { name: str(fd, "name"), description: str(fd, "description"), dataScope: str(fd, "dataScope") === "own" ? "own" : "all", active: fd.get("active") !== "0", permissions: fd.getAll("perm").map(String) });
  return { redirect: `/admin/roles/${id}?saved=1` };
});
export const settingsAction = act(async (a, fd) => {
  await Ad.saveSettings(a, { schoolName: str(fd, "schoolName"), address: str(fd, "address"), phone: str(fd, "phone"), email: str(fd, "email"), currencySymbol: str(fd, "currencySymbol") || "₦",
    dateFormat: str(fd, "dateFormat") as "dd/MM/yyyy", receiptPrefix: str(fd, "receiptPrefix"), receiptFooter: str(fd, "receiptFooter"), receiptShowApprover: bool(fd, "receiptShowApprover"),
    allowSelfApprovalPayments: bool(fd, "allowSelfApprovalPayments"), allowSelfApprovalExpenses: bool(fd, "allowSelfApprovalExpenses"), largePaymentThreshold: str(fd, "largePaymentThreshold"), ageingBands: str(fd, "ageingBands") });
  return { message: "Settings saved." };
});
export const logoAction = act(async (a, fd) => { requirePerm(a, "settings.manage"); const f = await fileOf(fd, "logo"); if (!f) return { message: "Choose an image." }; await Ad.setLogo(a, await storeFile(f, { images: true })); return { message: "Logo updated." }; });
export const channelAction = act(async (a, fd) => { await Ad.saveChannel(a, optNum(fd, "id"), { name: str(fd, "name"), requiresReference: bool(fd, "requiresReference"), requiresEvidence: bool(fd, "requiresEvidence"), active: fd.get("active") !== "0" }); return { message: "Payment channel saved." }; });
export const passwordAction = act(async (a, fd) => {
  if (str(fd, "next") !== str(fd, "confirm")) throw new ValidationError("New passwords do not match.", { confirm: "Does not match" });
  await changeOwnPassword(a, str(fd, "current"), str(fd, "next")); return { message: "Password changed." };
});
export const markReadAction = act(async (a, fd) => { await markRead(a, optNum(fd, "id") ?? undefined); return { message: "Marked as read." }; });
