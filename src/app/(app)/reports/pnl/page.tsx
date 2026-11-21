import { requirePage } from "@/server/session";
import { profitAndLoss } from "@/server/services/analytics";
import { listSessions, listTerms } from "@/server/services/academics";
import { PageHeader, Card, N, Alert } from "@/components/ui";
import { SP, sp1 } from "@/components/DataTable";
import { todayISO, parseDateInput, formatDate } from "@/lib/dates";
import { formatNaira } from "@/lib/money";

type Side = { category: string; amount: number; group?: string }[];
function Statement({ title, income, expenses, ti, te, surplus, margin, prev }: { title: string; income: Side; expenses: Side; ti: number; te: number; surplus: number; margin: number | null; prev?: { ti: number; te: number; surplus: number } }) {
  const row = (l: string, v: number, p?: number, cls = "") => <tr className={cls}><td className="td">{l}</td><td className="td num"><N k={v} /></td>{prev && <td className="td num text-slate-500">{p === undefined ? "" : formatNaira(p)}</td>}</tr>;
  return (
    <Card title={title} pad={false}>
      <table><thead><tr><th className="th"> </th><th className="th text-right">This period</th>{prev && <th className="th text-right">Previous period</th>}</tr></thead>
        <tbody>
          <tr><td className="td pt-4 text-xs font-semibold uppercase text-slate-400" colSpan={3}>Income</td></tr>
          {income.map((i) => row(i.category, i.amount))}
          {row("Total income", ti, prev?.ti, "font-semibold bg-slate-50")}
          <tr><td className="td pt-4 text-xs font-semibold uppercase text-slate-400" colSpan={3}>Expenditure</td></tr>
          {expenses.map((i) => row(i.category, i.amount))}
          {row("Total expenditure", te, prev?.te, "font-semibold bg-slate-50")}
          <tr className="text-base font-bold"><td className="td">Operating surplus / (deficit)</td><td className={`td num ${surplus < 0 ? "text-rose-600" : "text-brand-700"}`}><N k={surplus} /></td>{prev && <td className="td num text-slate-500">{formatNaira(prev.surplus)}</td>}</tr>
          <tr><td className="td text-sm text-slate-500">Operating margin</td><td className="td num text-sm">{margin === null ? "n/a" : `${(margin / 10).toFixed(1)}%`}</td>{prev && <td />}</tr>
        </tbody></table>
    </Card>
  );
}

export default async function PnL({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("reports.financial");
  const sp = await searchParams;
  const [sessions, terms] = await Promise.all([listSessions(), listTerms()]);
  let from = parseDateInput(sp1(sp, "from")), to = parseDateInput(sp1(sp, "to"));
  const t = terms.find((x) => x.id === Number(sp1(sp, "termId"))), s = sessions.find((x) => x.id === Number(sp1(sp, "sessionId")));
  const year = Number(sp1(sp, "year"));
  if (t?.startDate && t.endDate) { from = t.startDate; to = t.endDate; } else if (s?.startDate && s.endDate) { from = s.startDate; to = s.endDate; } else if (year) { from = `${year}-01-01`; to = `${year}-12-31`; }
  from = from ?? `${todayISO().slice(0, 4)}-01-01`; to = to ?? todayISO();
  const d = await profitAndLoss(a, { from, to });
  return (
    <>
      <PageHeader title="Income & expenditure statement" back={{ href: "/reports", label: "Reports" }} subtitle={`${formatDate(from)} – ${formatDate(to)} · compared with ${formatDate(d.cash.range.from === from ? d.prevCash.range.from : from)} – ${formatDate(d.prevCash.range.to)}`} actions={<span className="text-xs text-slate-400">Use your browser&apos;s Print for a PDF copy</span>} />
      <form method="get" className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50/70 p-3">
        <div className="w-40"><label htmlFor="f" className="mb-1 block text-xs">From</label><input id="f" type="date" name="from" defaultValue={from} /></div>
        <div className="w-40"><label htmlFor="t" className="mb-1 block text-xs">To</label><input id="t" type="date" name="to" defaultValue={to} /></div>
        <div className="w-44"><label htmlFor="tm" className="mb-1 block text-xs">…or a term</label><select id="tm" name="termId" defaultValue={sp1(sp, "termId")}><option value="">—</option>{terms.map((x) => <option key={x.id} value={x.id}>{x.name} {sessions.find((y) => y.id === x.sessionId)?.name}</option>)}</select></div>
        <div className="w-40"><label htmlFor="ss" className="mb-1 block text-xs">…or a session</label><select id="ss" name="sessionId" defaultValue={sp1(sp, "sessionId")}><option value="">—</option>{sessions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="w-32"><label htmlFor="y" className="mb-1 block text-xs">…or calendar year</label><input id="y" name="year" type="number" defaultValue={sp1(sp, "year")} placeholder="2026" /></div>
        <button className="btn-primary">Apply</button>
      </form>
      <div className="mb-4"><Alert tone="info" title="Basis of preparation">
        <b>Cash basis</b> (left): approved fee receipts and other income received, minus expenses actually paid, salaries paid and bank charges. Transfers between school accounts and pending/rejected items are excluded; reversals are deducted when they occur.
        <b> Accrual-style view</b> (right): fees charged in the period (net of waivers) minus expenses incurred/approved and approved payroll cost. This system does not keep a full double-entry general ledger; treat the accrual view as management information, not audited accounts. Collections are never presented as profit.
      </Alert></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Statement title="Cash basis" income={d.cash.income} expenses={d.cash.expenses} ti={d.cash.totalIncome} te={d.cash.totalExpenses} surplus={d.cash.surplus} margin={d.cash.marginTenths}
          prev={{ ti: d.prevCash.totalIncome, te: d.prevCash.totalExpenses, surplus: d.prevCash.surplus }} />
        <Statement title="Accrual-style (charged vs incurred)" income={d.accrual.income} expenses={d.accrual.expenses} ti={d.accrual.totalIncome} te={d.accrual.totalExpenses} surplus={d.accrual.surplus} margin={d.accrual.marginTenths} />
      </div>
      <Card title="Shown separately (not cash, not profit)" className="mt-4">
        <table><tbody>
          <tr><td className="td">Outstanding student fees (receivable)</td><td className="td num"><N k={d.outstandingFees} /></td></tr>
          <tr><td className="td">Approved but unpaid expenses ({d.unpaid.approvedUnpaidCount})</td><td className="td num"><N k={d.unpaid.approvedUnpaidExpenses} /></td></tr>
          <tr><td className="td">Approved but unpaid salaries</td><td className="td num"><N k={d.unpaid.unpaidSalaries} /></td></tr>
        </tbody></table>
      </Card>
    </>
  );
}
