import { requirePage } from "@/server/session";
import { revenueAnalysis, monthlyTrend } from "@/server/services/analytics";
import { getStructure } from "@/server/services/academics";
import { PageHeader, Card, N, Bar } from "@/components/ui";
import { FilterBar, SP, sp1 } from "@/components/DataTable";
import { Breakdown } from "@/components/Breakdown";
import { LineTrend } from "@/components/client/charts";
import { todayISO, parseDateInput, formatDate } from "@/lib/dates";
import { pct } from "@/lib/money";

export default async function Revenue({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("reports.financial");
  const sp = await searchParams;
  const st = await getStructure();
  const from = parseDateInput(sp1(sp, "from")) ?? `${todayISO().slice(0, 4)}-01-01`, to = parseDateInput(sp1(sp, "to")) ?? todayISO();
  const sessionId = Number(sp1(sp, "sessionId")) || undefined, termId = Number(sp1(sp, "termId")) || undefined;
  const d = await revenueAnalysis(a, { from, to }, { sessionId, termId });
  const trend = await monthlyTrend(12, to);
  const total = d.byCategory.reduce((t, x) => t + x.amount, 0);
  return (
    <>
      <PageHeader title="Revenue analysis" back={{ href: "/reports", label: "Reports" }} subtitle={`Approved collections ${formatDate(from)} – ${formatDate(to)}, compared with ${formatDate(d.prev.from)} – ${formatDate(d.prev.to)}`} />
      <FilterBar path="/reports/revenue" sp={{ from, to, ...sp }} fields={[{ name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "sessionId", label: "Session", type: "select", options: st.sessions.map((s) => ({ value: s.id, label: s.name })) },
        { name: "termId", label: "Term", type: "select", options: st.terms.map((t) => ({ value: t.id, label: `${t.name} ${st.sessions.find((s) => s.id === t.sessionId)?.name}` })) }]} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={total} /></div><div className="text-xs uppercase text-slate-400">Collected (period)</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={d.totals.expected} /></div><div className="text-xs uppercase text-slate-400">Expected (charges)</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold text-rose-600"><N k={d.totals.outstanding} /></div><div className="text-xs uppercase text-slate-400">Outstanding</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold text-brand-700">{pct(d.totals.paid, d.totals.expected)}</div><div className="text-xs uppercase text-slate-400">Collection rate</div></div>
      </div>
      <Card title="Fee collections by month (12 months)" className="mb-4"><LineTrend data={trend} series={[{ key: "fees", label: "Fee collections" }, { key: "expense", label: "Expenses" }]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By fee category (vs previous period)" rows={d.byCategory} prev={d.prevByCategory} count="payments" />
        <Card title="Expected vs approved vs outstanding by category" pad={false}>
          <table><thead><tr>{["Category", "Expected", "Paid", "Outstanding", "Rate"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{d.expectedByCategory.map((x) => <tr key={x.key}><td className="td">{x.key}</td><td className="td num"><N k={x.expected} /></td><td className="td num"><N k={x.paid} /></td><td className="td num"><N k={x.outstanding} /></td>
              <td className="td w-28"><div className="text-xs">{pct(x.paid, x.expected)}</div><Bar value={x.paid} max={x.expected} tone="emerald" /></td></tr>)}</tbody></table>
        </Card>
        <Breakdown title="By fee (session / term)" rows={d.byFee} count="payments" />
        <Breakdown title="By class" rows={d.byClass} />
        <Breakdown title="By term / session" rows={d.byTerm} />
        <Breakdown title="By payment channel" rows={d.byChannel} count="payments" />
        <Breakdown title="By receiving account" rows={d.byAccount} />
      </div>
    </>
  );
}
