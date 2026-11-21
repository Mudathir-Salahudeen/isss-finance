import Link from "next/link";
import { requirePage } from "@/server/session";
import { expenseAnalysis, monthlyTrend } from "@/server/services/analytics";
import { PageHeader, Card, N, D, StatusBadge } from "@/components/ui";
import { FilterBar, SP, sp1 } from "@/components/DataTable";
import { Breakdown } from "@/components/Breakdown";
import { TrendChart } from "@/components/client/charts";
import { todayISO, parseDateInput, formatDate } from "@/lib/dates";

export default async function ExpenseAnalysis({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("reports.financial");
  const sp = await searchParams;
  const from = parseDateInput(sp1(sp, "from")) ?? `${todayISO().slice(0, 4)}-01-01`, to = parseDateInput(sp1(sp, "to")) ?? todayISO();
  const d = await expenseAnalysis(a, { from, to });
  const trend = await monthlyTrend(12, to);
  const paid = d.byCategory.reduce((t, x) => t + x.amount, 0);
  const st = (s: string) => d.statusTotals.find((x) => x.status === s);
  return (
    <>
      <PageHeader title="Expense analysis" back={{ href: "/reports", label: "Reports" }} subtitle={`Paid expenses ${formatDate(from)} – ${formatDate(to)} (excludes payroll, which is reported under Payroll)`}
        actions={<Link className="btn-secondary" href={`/reports/expenses_list?from=${from}&to=${to}`}>Expense register</Link>} />
      <FilterBar path="/reports/expenses" sp={{ from, to, ...sp }} fields={[{ name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" }]} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={paid} /></div><div className="text-xs uppercase text-slate-400">Paid in period</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold text-amber-600"><N k={st("approved")?.amount ?? 0} /></div><div className="text-xs uppercase text-slate-400">Approved, unpaid (incurred in period)</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={st("pending")?.amount ?? 0} /></div><div className="text-xs uppercase text-slate-400">Pending approval</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold text-slate-400"><N k={st("rejected")?.amount ?? 0} /></div><div className="text-xs uppercase text-slate-400">Rejected</div></div>
      </div>
      <Card title="Month-on-month spending (cash basis, incl. salaries)" className="mb-4"><TrendChart data={trend} series={[{ key: "expense", label: "Spending" }, { key: "income", label: "Income" }]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By category (vs previous period)" rows={d.byCategory} prev={d.prevByCategory} count="items" />
        <Breakdown title="By vendor / payee" rows={d.byVendor} count="items" />
        <Breakdown title="By month" rows={d.byMonth} />
        <Breakdown title="By department" rows={d.byDepartment} />
        <Breakdown title="By paying account" rows={d.byAccount} />
        <Breakdown title="By person who entered it" rows={d.byEnteredBy} count="items" />
      </div>
      <Card title="Recurring expense schedule" pad={false} className="mt-4">
        <table><thead><tr>{["Expense", "Category", "Recurs", "Last amount", "Last date", "Next due (estimate)", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{d.recurring.map((r) => <tr key={String(r.id)}><td className="td"><Link className="link" href={`/expenses/${r.id}`}>{String(r.title)}</Link></td><td className="td">{String(r.category)}</td><td className="td">{String(r.recurrence)}</td>
            <td className="td num"><N k={r.amount} /></td><td className="td"><D d={String(r.date_incurred)} /></td><td className="td"><D d={r.nextDue} /></td><td className="td"><StatusBadge status={String(r.status)} /></td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
