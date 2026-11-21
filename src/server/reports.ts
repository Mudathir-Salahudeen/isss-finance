/**
 * Report registry: one definition per tabular report. List pages render it, and /api/export uses the
 * very same fetch() for CSV / Excel / PDF — so exported totals always equal what is on screen.
 */
import { Actor, can, requireAny } from "./actor";
import { ExportColumn } from "@/lib/spreadsheet";
import { listPayments } from "./services/payments";
import { listExpenses } from "./services/expenses";
import { debtors, feeCollectionReport } from "./services/analytics";
import { accountBalances, accountTransactionsList, listTransfers } from "./services/accounts";
import { listAudit } from "./services/auditlog";
import { listPeriods, getPeriod, listStaff } from "./services/payroll";
import { listStudents } from "./services/students";
import { listReconciliations } from "./services/recon";
import { promotionHistory } from "./services/promotion";
import { studentStatement } from "./services/ledger";
import { getImportBatch, IMPORT_FIELDS, ImportKind } from "./services/imports";
import { parseNaira } from "@/lib/money";
import { formatDateTime, parseDateInput } from "@/lib/dates";

export type Params = Record<string, string | undefined>;
const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const date = (v?: string) => (v ? parseDateInput(v) ?? undefined : undefined);
const money = (v?: string) => (v ? parseNaira(v) ?? undefined : undefined);

export interface ReportResult { rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null; meta?: string[] }
export interface ReportDef {
  title: string; perms: string[]; sensitive?: boolean; columns: ExportColumn[];
  fetch: (actor: Actor, p: Params) => Promise<ReportResult>;
}

const sumBy = (rows: Record<string, unknown>[], keys: string[], label: Record<string, string>) => {
  const t: Record<string, unknown> = { ...label };
  for (const k of keys) t[k] = rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return t;
};

const paymentCols: ExportColumn[] = [
  { key: "paymentNo", label: "Payment No." }, { key: "receiptNo", label: "Receipt No." }, { key: "paymentDate", label: "Date", type: "date" },
  { key: "admissionNo", label: "Adm. No." }, { key: "studentName", label: "Student" }, { key: "className", label: "Class" }, { key: "fees", label: "Fee items" },
  { key: "amount", label: "Amount", type: "money" }, { key: "channelName", label: "Method" }, { key: "accountName", label: "Account" }, { key: "reference", label: "Reference" },
  { key: "status", label: "Status" }, { key: "recordedByName", label: "Recorded by" }, { key: "decidedByName", label: "Approver" },
];

const paymentFilters = (p: Params) => ({ q: p.q, status: p.status, sessionId: num(p.sessionId), termId: num(p.termId), accountId: num(p.accountId), channelId: num(p.channelId),
  recordedBy: num(p.recordedBy), from: date(p.from), to: date(p.to), classId: num(p.classId), feeId: num(p.feeId), studentId: num(p.studentId) });

export const REPORTS: Record<string, ReportDef> = {
  payments: {
    title: "Payments", perms: ["payments.view", "payments.approve"], columns: paymentCols,
    fetch: async (a, p) => { const rows = await listPayments(a, paymentFilters(p)); return { rows: rows as unknown as Record<string, unknown>[], totals: sumBy(rows as unknown as Record<string, unknown>[], ["amount"], { paymentNo: "TOTAL" }) }; },
  },
  collections: {
    title: "Collection report (approved payments)", perms: ["reports.view", "payments.approve"], columns: paymentCols,
    fetch: async (a, p) => { const rows = await listPayments(a, { ...paymentFilters(p), status: "approved" }); return { rows: rows as unknown as Record<string, unknown>[], totals: sumBy(rows as unknown as Record<string, unknown>[], ["amount"], { paymentNo: "TOTAL APPROVED" }), meta: ["Basis: approved payments only. Pending, rejected and reversed payments are excluded."] }; },
  },
  pending: {
    title: "Payments pending Director approval", perms: ["payments.view", "payments.approve"],
    columns: [...paymentCols.filter((c) => !["receiptNo", "decidedByName"].includes(c.key)), { key: "ageDays", label: "Age (days)", type: "number" }, { key: "evidenceCount", label: "Evidence files", type: "number" }],
    fetch: async (a, p) => {
      const rows = (await listPayments(a, { ...paymentFilters(p), status: "pending" })).map((r) => ({ ...r, ageDays: Math.floor((Date.now() - new Date(r.submittedAt ?? r.recordedAt).getTime()) / 86400000) }));
      return { rows, totals: sumBy(rows, ["amount"], { paymentNo: "TOTAL PENDING" }), meta: ["Pending payments have NOT been credited to student balances or collections."] };
    },
  },
  rejected: {
    title: "Rejected payments", perms: ["payments.view", "payments.approve"],
    columns: [...paymentCols.filter((c) => !["receiptNo"].includes(c.key)), { key: "decidedAt", label: "Rejected on" }, { key: "rejectionReason", label: "Reason" }],
    fetch: async (a, p) => { const rows = await listPayments(a, { ...paymentFilters(p), status: "rejected" }); return { rows: rows as unknown as Record<string, unknown>[] }; },
  },
  debtors: {
    title: "Debtors", perms: ["debtors.view"],
    columns: [{ key: "admissionNo", label: "Adm. No." }, { key: "studentName", label: "Student" }, { key: "className", label: "Class" }, { key: "armName", label: "Arm" },
      { key: "net", label: "Fees assigned (net)", type: "money" }, { key: "paid", label: "Approved paid", type: "money" }, { key: "pending", label: "Awaiting approval", type: "money" },
      { key: "outstanding", label: "Balance", type: "money" }, { key: "overdueAmount", label: "Overdue", type: "money" }, { key: "ageing", label: "Ageing" }, { key: "status", label: "Status" }],
    fetch: async (a, p) => {
      const r = await debtors(a, { sessionId: num(p.sessionId), termId: num(p.termId), classId: num(p.classId), armId: num(p.armId), feeId: num(p.feeId), categoryId: num(p.categoryId),
        status: p.status, min: money(p.min), max: money(p.max), overdueOnly: p.overdue === "1", band: p.band, q: p.q, dueFrom: date(p.dueFrom), dueTo: date(p.dueTo) });
      return { rows: r.list as unknown as Record<string, unknown>[], totals: { admissionNo: "TOTAL", studentName: `${r.totals.students} student(s)`, net: r.totals.net, paid: r.totals.paid, pending: r.totals.pending, outstanding: r.totals.outstanding, overdueAmount: r.totals.overdue },
        meta: ["Balance = assigned charges + adjustments − APPROVED payments. Amounts awaiting approval are shown separately and do not reduce the balance."] };
    },
  },
  fee_collection: {
    title: "Fee collection performance", perms: ["fees.view", "reports.view"],
    columns: [{ key: "feeName", label: "Fee" }, { key: "categoryName", label: "Category" }, { key: "sessionName", label: "Session" }, { key: "termName", label: "Term" },
      { key: "students", label: "Students", type: "number" }, { key: "expected", label: "Expected", type: "money" }, { key: "paid", label: "Approved paid", type: "money" },
      { key: "pending", label: "Pending", type: "money" }, { key: "outstanding", label: "Outstanding", type: "money" }, { key: "rate", label: "Collection rate" }, { key: "debtors", label: "Debtors", type: "number" }],
    fetch: async (a, p) => {
      const r = await feeCollectionReport(a, { sessionId: num(p.sessionId), termId: num(p.termId), categoryId: num(p.categoryId), feeId: num(p.feeId), classId: num(p.classId) });
      const rows = r.list.map((x) => ({ ...x, rate: `${(x.rateTenths / 10).toFixed(1)}%` }));
      return { rows, totals: { feeName: "TOTAL", ...r.totals, rate: r.totals.expected ? `${((r.totals.paid * 1000) / r.totals.expected / 10).toFixed(1)}%` : "0.0%" } };
    },
  },
  expenses: {
    title: "Expenses", perms: ["expenses.view", "expenses.create", "expenses.approve"],
    columns: [{ key: "expenseNo", label: "Expense No." }, { key: "dateIncurred", label: "Date incurred", type: "date" }, { key: "title", label: "Title" }, { key: "categoryName", label: "Category" },
      { key: "payee", label: "Payee / vendor" }, { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status" }, { key: "accountName", label: "Account" },
      { key: "paidDate", label: "Paid on", type: "date" }, { key: "paidReference", label: "Payment ref." }, { key: "createdByName", label: "Entered by" }, { key: "createdByRole", label: "Entrant role" }, { key: "approvedByName", label: "Approver" }],
    fetch: async (a, p) => {
      const rows = await listExpenses(a, { q: p.q, status: p.status, categoryId: num(p.categoryId), accountId: num(p.accountId), createdBy: num(p.createdBy), approvedBy: num(p.approvedBy),
        vendorId: num(p.vendorId), from: date(p.from), to: date(p.to), entrantRole: p.entrant === "director" ? "director" : p.entrant === "other" ? "other" : undefined, payee: p.payee,
        recurring: p.recurring === "1", dateBasis: p.basis === "paid" ? "paid" : "incurred" });
      return { rows: rows as unknown as Record<string, unknown>[], totals: sumBy(rows as unknown as Record<string, unknown>[], ["amount"], { expenseNo: "TOTAL" }) };
    },
  },
  accounts: {
    title: "Bank & cash accounts", perms: ["accounts.view"],
    columns: [{ key: "name", label: "Account" }, { key: "type", label: "Type" }, { key: "provider", label: "Bank / provider" }, { key: "accountNumberMasked", label: "Account No." },
      { key: "bookBalance", label: "Book balance", type: "money" }, { key: "lastReconciledBalance", label: "Last reconciled statement balance", type: "money" }, { key: "lastReconciledDate", label: "Reconciled to", type: "date" },
      { key: "unmatchedLines", label: "Unmatched lines", type: "number" }, { key: "active", label: "Active" }],
    fetch: async () => { const rows = await accountBalances(); return { rows: rows as unknown as Record<string, unknown>[], totals: sumBy(rows as unknown as Record<string, unknown>[], ["bookBalance"], { name: "TOTAL BOOK BALANCE" }),
      meta: ["Book balance = opening balance + all posted transactions in this system. Statement balance comes from the last reconciliation."] }; },
  },
  account_txns: {
    title: "Account transactions", perms: ["accounts.view"],
    columns: [{ key: "txnDate", label: "Date", type: "date" }, { key: "kind", label: "Type" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" },
      { key: "moneyIn", label: "Money in", type: "money" }, { key: "moneyOut", label: "Money out", type: "money" }, { key: "runningBalance", label: "Balance", type: "money" }, { key: "reconciled", label: "Matched to statement" }, { key: "createdByName", label: "Posted by" }],
    fetch: async (_a, p) => {
      const id = num(p.accountId);
      if (!id) return { rows: [] };
      const r = await accountTransactionsList(id, { from: date(p.from), to: date(p.to) });
      const rows = r.rows.map((x) => ({ ...x, moneyIn: x.amount > 0 ? x.amount : null, moneyOut: x.amount < 0 ? -x.amount : null }));
      return { rows: [{ txnDate: date(p.from) ?? "", kind: "", description: "Opening balance", runningBalance: r.opening }, ...rows],
        totals: { txnDate: "", description: "CLOSING BALANCE", moneyIn: rows.reduce((t, x) => t + (x.moneyIn ?? 0), 0), moneyOut: rows.reduce((t, x) => t + (x.moneyOut ?? 0), 0), runningBalance: r.closing } };
    },
  },
  transfers: {
    title: "Transfers between accounts", perms: ["accounts.view"],
    columns: [{ key: "transfer_date", label: "Date", type: "date" }, { key: "from_name", label: "From" }, { key: "to_name", label: "To" }, { key: "amount", label: "Amount", type: "money" },
      { key: "reference", label: "Reference" }, { key: "notes", label: "Notes" }, { key: "status", label: "Status" }, { key: "created_by_name", label: "Recorded by" }],
    fetch: async () => { const rows = (await listTransfers()).map((r) => ({ ...r, amount: Number(r.amount) })); return { rows, meta: ["Transfers move money between school accounts. They are never counted as income or expense."] }; },
  },
  reconciliations: {
    title: "Reconciliations", perms: ["recon.view"],
    columns: [{ key: "accountName", label: "Account" }, { key: "periodStart", label: "From", type: "date" }, { key: "periodEnd", label: "To", type: "date" }, { key: "statementBalance", label: "Statement / counted", type: "money" },
      { key: "bookBalance", label: "Book balance", type: "money" }, { key: "difference", label: "Difference", type: "money" }, { key: "status", label: "Status" }, { key: "by", label: "Reconciled by" }],
    fetch: async (a, p) => ({ rows: (await listReconciliations(a, num(p.accountId))).map((x) => ({ ...x.r, accountName: x.accountName, by: x.by })) }),
  },
  students: {
    title: "Students", perms: ["students.view"],
    columns: [{ key: "admissionNo", label: "Adm. No." }, { key: "lastName", label: "Surname" }, { key: "firstName", label: "First name" }, { key: "middleName", label: "Middle name" }, { key: "gender", label: "Gender" },
      { key: "className", label: "Class" }, { key: "armName", label: "Arm" }, { key: "sessionName", label: "Session" }, { key: "status", label: "Status" }, { key: "guardianName", label: "Guardian" }, { key: "guardianPhone", label: "Phone" }],
    fetch: async (_a, p) => ({ rows: (await listStudents({ q: p.q, classId: num(p.classId), armId: num(p.armId), status: p.status })) as unknown as Record<string, unknown>[] }),
  },
  promotions: {
    title: "Promotion history", perms: ["students.view"],
    columns: [{ key: "performed_at", label: "When" }, { key: "admission_no", label: "Adm. No." }, { key: "student_name", label: "Student" }, { key: "action", label: "Action" },
      { key: "from_session", label: "From session" }, { key: "from_class", label: "From class" }, { key: "from_arm", label: "Arm" }, { key: "to_session", label: "To session" }, { key: "to_class", label: "To class" },
      { key: "to_arm", label: "Arm" }, { key: "performed_by_name", label: "By" }, { key: "reversed_at", label: "Reversed" }, { key: "reversal_reason", label: "Reversal reason" }],
    fetch: async (_a, p) => ({ rows: (await promotionHistory({ sessionId: num(p.sessionId), classId: num(p.classId), action: p.action })).map((r) => ({ ...r, performed_at: formatDateTime(r.performed_at as Date), reversed_at: r.reversed_at ? formatDateTime(r.reversed_at as Date) : "" })) }),
  },
  staff: {
    title: "Staff & salaries", perms: ["payroll.view"], sensitive: true,
    columns: [{ key: "staffNo", label: "Staff ID" }, { key: "fullName", label: "Name" }, { key: "department", label: "Department" }, { key: "position", label: "Position" }, { key: "status", label: "Status" },
      { key: "basic", label: "Basic", type: "money" }, { key: "allowances", label: "Allowances", type: "money" }, { key: "deductions", label: "Deductions", type: "money" }, { key: "loanBalance", label: "Loan balance", type: "money" }],
    fetch: async (a) => { const rows = await listStaff(a); return { rows, totals: sumBy(rows, ["basic", "allowances", "deductions", "loanBalance"], { staffNo: "TOTAL" }) }; },
  },
  payroll: {
    title: "Payroll summary", perms: ["payroll.view"], sensitive: true,
    columns: [{ key: "period", label: "Period" }, { key: "status", label: "Status" }, { key: "staff_count", label: "Staff", type: "number" }, { key: "gross", label: "Gross", type: "money" },
      { key: "deductions", label: "Deductions", type: "money" }, { key: "net", label: "Net", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "unpaid", label: "Unpaid", type: "money" }, { key: "approved_by_name", label: "Approved by" }],
    fetch: async (a) => { const rows = (await listPeriods(a)).filter((r) => r.status !== "cancelled").map((r) => ({ ...r, unpaid: ["approved", "partially_paid", "paid"].includes(r.status) ? r.net - r.paid : 0 }));
      return { rows, totals: sumBy(rows, ["gross", "deductions", "net", "paid", "unpaid"], { period: "TOTAL" }) }; },
  },
  payroll_lines: {
    title: "Payroll detail", perms: ["payroll.view"], sensitive: true,
    columns: [{ key: "staffNo", label: "Staff ID" }, { key: "fullName", label: "Name" }, { key: "department", label: "Dept." }, { key: "basic", label: "Basic", type: "money" }, { key: "allowances", label: "Allowances", type: "money" },
      { key: "bonus", label: "Bonus", type: "money" }, { key: "arrears", label: "Arrears", type: "money" }, { key: "gross", label: "Gross", type: "money" }, { key: "deductions", label: "Deductions", type: "money" },
      { key: "loanDeduction", label: "Loan/advance", type: "money" }, { key: "net", label: "Net", type: "money" }, { key: "paidAmount", label: "Paid", type: "money" }, { key: "status", label: "Status" }],
    fetch: async (a, p) => { const id = num(p.periodId); if (!id) return { rows: [] }; const r = await getPeriod(a, id);
      return { rows: r.lines, totals: sumBy(r.lines, ["basic", "allowances", "bonus", "arrears", "gross", "deductions", "loanDeduction", "net", "paidAmount"], { staffNo: "TOTAL" }), meta: [`${r.period.name} — status ${r.period.status}`] }; },
  },
  audit: {
    title: "Audit log", perms: ["audit.view"], sensitive: true,
    columns: [{ key: "atText", label: "When" }, { key: "userName", label: "User" }, { key: "module", label: "Module" }, { key: "action", label: "Action" }, { key: "recordType", label: "Record" },
      { key: "recordId", label: "Record ID" }, { key: "reason", label: "Reason" }, { key: "changes", label: "Details" }, { key: "ip", label: "IP" }],
    fetch: async (a, p) => {
      const rows = await listAudit(a, { from: date(p.from), to: date(p.to), userId: num(p.userId), module: p.module, action: p.action, recordType: p.recordType, recordId: p.recordId, q: p.q });
      return { rows: rows.map((r) => ({ ...r, atText: formatDateTime(r.at), changes: JSON.stringify({ old: r.oldValues ?? undefined, new: r.newValues ?? undefined }).slice(0, 600) })) };
    },
  },
  statement: {
    title: "Student statement of account", perms: ["ledger.view"],
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "description", label: "Description" }, { key: "reference", label: "Receipt / ref." }, { key: "session", label: "Session" },
      { key: "debit", label: "Charges", type: "money" }, { key: "credit", label: "Payments / credits", type: "money" }, { key: "balance", label: "Balance", type: "money" }],
    fetch: async (_a, p) => {
      const id = num(p.studentId); if (!id) return { rows: [] };
      const s = await studentStatement(id, { sessionId: num(p.sessionId) });
      return { rows: s.lines.map((l) => ({ ...l, debit: l.debit || null, credit: l.credit || null })), totals: { description: "TOTAL", debit: s.totals.debit, credit: s.totals.credit, balance: s.closing } };
    },
  },
  import_failed: {
    title: "Import rows that failed", perms: ["students.import", "payroll.manage_staff", "fees.assign", "fees.opening_balance", "audit.view"],
    columns: [],
    fetch: async (a, p) => {
      const b = await getImportBatch(a, num(p.batchId) ?? 0);
      const rows = (b.rowResults ?? []).filter((r) => p.all === "1" || r.outcome === "failed").map((r) => ({ row: r.row, outcome: r.outcome, error: r.message, ...r.data }));
      return { rows };
    },
  },
};

export function importFailedColumns(kind: string): ExportColumn[] {
  const f = IMPORT_FIELDS[kind as ImportKind] ?? [];
  return [{ key: "row", label: "Row" }, { key: "outcome", label: "Outcome" }, { key: "error", label: "Error / message" }, ...f.map((x) => ({ key: x.key, label: x.label }))];
}

export async function runReport(actor: Actor, key: string, p: Params) {
  const def = REPORTS[key];
  if (!def) throw new Error("Unknown report");
  requireAny(actor, ...def.perms);
  const result = await def.fetch(actor, p);
  let columns = def.columns;
  if (key === "import_failed") columns = importFailedColumns((await getImportBatch(actor, num(p.batchId) ?? 0)).kind);
  return { def, columns, ...result, canExport: can(actor, "reports.export") && (!def.sensitive || can(actor, "reports.export_sensitive")) };
}

export function describeFilters(p: Params) {
  const skip = new Set(["format", "page", "sort", "dir"]);
  const parts = Object.entries(p).filter(([k, v]) => v && !skip.has(k)).map(([k, v]) => `${k}=${v}`);
  return parts.length ? [`Filters: ${parts.join(", ")}`] : [];
}
