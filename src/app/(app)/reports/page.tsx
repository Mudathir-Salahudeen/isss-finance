import Link from "next/link";
import { requireAnyPage } from "@/server/session";
import { REPORTS } from "@/server/reports";
import { PageHeader } from "@/components/ui";
import { can } from "@/server/actor";

export const metadata = { title: "Reports" };
const GROUPS: [string, [string, string, string][]][] = [
  ["Financial statements", [["/reports/pnl", "Income & expenditure (P&L)", "Cash-basis and accrual-style views, previous-period comparison."], ["/reports/revenue", "Revenue analysis", "By fee type, class, term, channel and account; expected vs paid."], ["/reports/expenses", "Expense analysis", "By category, vendor, department, month; recurring schedule."]]],
  ["Fees & collections", [["/reports/collections", "Collection report", "Approved payments with full filters."], ["/reports/pending", "Pending approval", "Submitted payments awaiting the Director, with age."], ["/reports/rejected", "Rejected payments", "With reasons, recorder and approver."], ["/reports/fee_collection", "Fee collection performance", "Expected, paid, outstanding and rate per fee."], ["/debtors", "Debtors & ageing", "Balances by student with ageing bands."]]],
  ["Accounts", [["/accounts", "Bank & cash balances", "Book vs statement balances."], ["/reports/transfers", "Transfers", "Movements between school accounts."], ["/reports/reconciliations", "Reconciliations", "Periods, differences and reviewers."]]],
  ["Expenses & payroll", [["/reports/expenses_list", "Expense register", "Every expense with status, approver and payment."], ["/reports/payroll", "Payroll summary", "Gross, deductions, net, paid, unpaid (restricted)."], ["/reports/staff", "Staff & salaries", "Restricted."]]],
  ["Students & audit", [["/reports/students", "Student register", ""], ["/reports/promotions", "Promotion report", "Promoted, repeated, transferred, withdrawn."], ["/reports/audit", "Audit log export", "Restricted."]]],
];
const PERM: Record<string, string[]> = { "/reports/pnl": ["reports.financial"], "/reports/revenue": ["reports.financial"], "/reports/expenses": ["reports.financial"] };
export default async function Reports() {
  const a = await requireAnyPage("reports.view", "reports.financial");
  const visible = (href: string) => {
    const key = href.replace("/reports/", "").replace("expenses_list", "expenses");
    const perms = PERM[href] ?? REPORTS[key]?.perms ?? (href === "/debtors" ? ["debtors.view"] : href === "/accounts" ? ["accounts.view"] : []);
    return !perms.length || perms.some((p) => can(a, p));
  };
  return (
    <>
      <PageHeader title="Reports" subtitle="Every report can be filtered, printed to PDF and exported to Excel/CSV (exports are logged)." />
      <div className="space-y-6">{GROUPS.map(([g, items]) => {
        const v = items.filter(([h]) => visible(h));
        if (!v.length) return null;
        return (<section key={g}><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{v.map(([h, t, d]) => <Link key={h} href={h} className="card block p-5 transition hover:shadow-md"><div className="font-medium text-slate-900">{t}</div><div className="mt-1 text-sm text-slate-500">{d}</div></Link>)}</div></section>);
      })}</div>
    </>
  );
}
