"use server";
import { act, str, optNum, reqNum, bool, fileOf } from "@/server/action";
import * as E from "@/server/services/expenses";

const input = (fd: FormData) => ({ title: str(fd, "title"), description: str(fd, "description"), categoryId: reqNum(fd, "categoryId"), subcategory: str(fd, "subcategory"), amount: str(fd, "amount"),
  dateIncurred: str(fd, "dateIncurred"), vendorId: optNum(fd, "vendorId"), payeeName: str(fd, "payeeName"), paymentMethod: str(fd, "paymentMethod"), accountId: optNum(fd, "accountId"),
  recurring: bool(fd, "recurring"), recurrence: str(fd, "recurrence") || null, department: str(fd, "department"), idempotencyKey: str(fd, "idempotencyKey") || undefined });

export const createExpenseAction = act(async (a, fd) => { const id = await E.createExpense(a, input(fd), { submit: str(fd, "intent") !== "draft", evidence: await fileOf(fd, "evidence") }); return { redirect: `/expenses/${id}` }; });
export const updateExpenseAction = act(async (a, fd) => { await E.updateExpenseDraft(a, reqNum(fd, "id"), input(fd)); return { message: "Draft updated." }; });
export const submitExpenseAction = act(async (a, fd) => { await E.submitExpense(a, reqNum(fd, "id")); return { message: "Submitted for approval." }; });
export const approveExpenseAction = act(async (a, fd) => { await E.approveExpense(a, reqNum(fd, "id"), str(fd, "comment")); return { redirect: `/expenses/${reqNum(fd, "id")}?done=approved` }; });
export const rejectExpenseAction = act(async (a, fd) => { await E.rejectExpense(a, reqNum(fd, "id"), str(fd, "reason")); return { redirect: `/expenses/${reqNum(fd, "id")}?done=rejected` }; });
export const payExpenseAction = act(async (a, fd) => { await E.payExpense(a, reqNum(fd, "id"), { paidDate: str(fd, "paidDate"), accountId: reqNum(fd, "accountId"), reference: str(fd, "reference"), evidence: await fileOf(fd, "evidence") }); return { redirect: `/expenses/${reqNum(fd, "id")}?done=paid` }; });
export const cancelExpenseAction = act(async (a, fd) => { await E.cancelExpense(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Expense cancelled." }; });
export const reverseExpenseAction = act(async (a, fd) => { await E.reverseExpense(a, reqNum(fd, "id"), str(fd, "reason")); return { message: "Expense reversed." }; });
export const duplicateExpenseAction = act(async (a, fd) => { const id = await E.duplicateExpense(a, reqNum(fd, "id"), str(fd, "dateIncurred")); return { redirect: `/expenses/${id}` }; });
export const expenseCategoryAction = act(async (a, fd) => { await E.saveExpenseCategory(a, optNum(fd, "id"), { name: str(fd, "name"), parentId: optNum(fd, "parentId"), active: fd.get("active") !== "0" }); return { message: "Category saved." }; });
export const vendorAction = act(async (a, fd) => { await E.saveVendor(a, optNum(fd, "id"), { name: str(fd, "name"), contactPerson: str(fd, "contactPerson"), phone: str(fd, "phone"), email: str(fd, "email") }); return { message: "Vendor saved." }; });
