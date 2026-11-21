"use server";
import { act, str, optNum, reqNum } from "@/server/action";
import * as PR from "@/server/services/payroll";

const staffIn = (fd: FormData) => ({ staffNo: str(fd, "staffNo"), fullName: str(fd, "fullName"), department: str(fd, "department"), position: str(fd, "position"), status: (str(fd, "status") || "active") as "active",
  startDate: str(fd, "startDate") || null, salaryType: (str(fd, "salaryType") || "monthly") as "monthly", bankName: str(fd, "bankName"), bankAccountNumber: str(fd, "bankAccountNumber"),
  bankAccountName: str(fd, "bankAccountName"), phone: str(fd, "phone"), email: str(fd, "email") });
export const staffAction = act(async (a, fd) => { const id = optNum(fd, "id"); const nid = await PR.saveStaff(a, id, { ...staffIn(fd), basic: str(fd, "basic") || undefined, effectiveFrom: str(fd, "startDate") }); return id ? { message: "Saved." } : { redirect: `/payroll/staff/${nid}` }; });
export const salaryAction = act(async (a, fd) => { await PR.setSalary(a, reqNum(fd, "staffId"), str(fd, "basic"), str(fd, "effectiveFrom"), str(fd, "reason")); return { message: "Salary change recorded." }; });
export const payItemAction = act(async (a, fd) => { await PR.savePayItem(a, optNum(fd, "id"), reqNum(fd, "staffId"), { kind: str(fd, "kind") as "allowance", name: str(fd, "name"), amount: str(fd, "amount"), active: fd.get("active") !== "0" }); return { message: "Saved." }; });
export const loanAction = act(async (a, fd) => { await PR.addLoan(a, reqNum(fd, "staffId"), { kind: str(fd, "kind") as "loan", principal: str(fd, "principal"), monthlyDeduction: str(fd, "monthlyDeduction"), reason: str(fd, "reason") }); return { message: "Loan/advance recorded." }; });
export const generateAction = act(async (a, fd) => { const id = await PR.generatePayroll(a, str(fd, "period"), str(fd, "payDate") || undefined); return { redirect: `/payroll/periods/${id}` }; });
export const lineItemAction = act(async (a, fd) => { await PR.addLineItem(a, reqNum(fd, "lineId"), { kind: str(fd, "kind") as "bonus", name: str(fd, "name"), amount: str(fd, "amount") }); return { message: "Line adjusted." }; });
export const removeItemAction = act(async (a, fd) => { await PR.removeLineItem(a, reqNum(fd, "itemId")); return { message: "Removed." }; });
export const submitPayrollAction = act(async (a, fd) => { await PR.submitPayroll(a, reqNum(fd, "id")); return { message: "Submitted for approval." }; });
export const approvePayrollAction = act(async (a, fd) => { await PR.approvePayroll(a, reqNum(fd, "id"), str(fd, "comment")); return { message: "Payroll approved." }; });
export const rejectPayrollAction = act(async (a, fd) => { await PR.rejectPayroll(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Returned for correction." }; });
export const cancelPayrollAction = act(async (a, fd) => { await PR.cancelPayroll(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Cancelled." }; });
export const payLineAction = act(async (a, fd) => { await PR.paySalary(a, reqNum(fd, "lineId"), { amount: str(fd, "amount") || undefined, paymentDate: str(fd, "paymentDate"), accountId: reqNum(fd, "accountId"), reference: str(fd, "reference") }); return { message: "Salary payment recorded." }; });
export const payAllAction = act(async (a, fd) => { const n = await PR.payAllSalaries(a, reqNum(fd, "id"), { paymentDate: str(fd, "paymentDate"), accountId: reqNum(fd, "accountId"), reference: str(fd, "reference") }); return { message: `${n} salary payment(s) recorded.` }; });
export const reverseSalaryAction = act(async (a, fd) => { await PR.reverseSalaryPayment(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Salary payment reversed." }; });
