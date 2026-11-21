import Link from "next/link";
import { requirePage } from "@/server/session";
import { directorDashboard } from "@/server/services/analytics";
import { getStructure } from "@/server/services/academics";
import { listAccounts } from "@/server/services/accounts";
import { Card, PageHeader, Stat, N, DT, Alert, Bar, StatusBadge } from "@/components/ui";
import { FilterBar, SP, sp1 } from "@/components/DataTable";
import { TrendChart, HBar } from "@/components/client/charts";
import { formatNaira, pct } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { can } from "@/server/actor";
import { parseDateInput } from "@/lib/dates";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePage("dashboard.view");
  const sp = await searchParams;
  const st = await getStructure();
  const curTerm = st.terms.find((t) => t.isCurrent);
  const curSession = st.sessions.find((s) => s.isCurrent);
  const from = parseDateInput(sp1(sp, "from")) ?? curTerm?.startDate ?? `${todayISO().slice(0, 7)}-01`;
  const to = parseDateInput(sp1(sp, "to")) ?? todayISO();
  const sessionId = sp1(sp, "sessionId") === "all" ? undefined : Number(sp1(sp, "sessionId")) || curSession?.id;
  const termId = Number(sp1(sp, "termId")) || undefined;
  const classId = Number(sp1(sp, "classId")) || undefined;
  const accountId = Number(sp1(sp, "accountId")) || undefined;
  const d = await directorDashboard(actor, { range: { from, to }, sessionId, termId, classId, accountId });
  const accounts = can(actor, "accounts.view") ? await listAccounts() : [];
  const change = d.prevCollections ? Math.round(((d.collections - d.prevCollections) * 1000) / d.prevCollections) / 10 : null;
  const sessName = st.sessions.find((s) => s.id === sessionId)?.name ?? "all sessions";
  const termName = st.terms.find((t) => t.id === termId)?.name;

  return (
    <>
      <PageHeader title={d.isDirector ? "Director dashboard" : "Dashboard"} subtitle={<>Period {from.split("-").reverse().join("/")} – {to.split("-").reverse().join("/")} · Fees for {sessName}{termName ? ` — ${termName}` : ""}</>}
        actions={<>{can(actor, "payments.create") && <Link href="/payments/new" className="btn-primary">Record payment</Link>}{can(actor, "expenses.create") && <Link href="/expenses/new" className="btn-secondary">Record expense</Link>}</>} />
      <FilterBar path="/dashboard" sp={{ from, to, sessionId: sessionId ? String(sessionId) : "all", ...sp }} fields={[
        { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "sessionId", label: "Session (fees)", type: "select", options: [{ value: "all", label: "All sessions" }, ...st.sessions.map((s) => ({ value: s.id, label: s.name }))] },
        { name: "termId", label: "Term", type: "select", options: st.terms.filter((t) => !sessionId || t.sessionId === sessionId).map((t) => ({ value: t.id, label: `${t.name} ${st.sessions.find((s) => s.id === t.sessionId)?.name ?? ""}` })) },
        { name: "classId", label: "Class", type: "select", options: st.classes.map((c) => ({ value: c.id, label: c.name })) },
        ...(accounts.length ? [{ name: "accountId", label: "Receiving account", type: "select" as const, options: accounts.map((a) => ({ value: a.id, label: a.name })) }] : []),
      ]} />

      {(d.pending.count > 0 || d.unmatched.count > 0 || d.expenses.pendingOthers.n + d.expenses.pendingDirector.n > 0) && (
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          {d.pending.count > 0 && <Alert tone="warn" title={`${d.pending.count} student payment(s) awaiting approval — ${formatNaira(d.pending.total)}`}>
            {d.pending.flagged > 0 && <>{d.pending.flagged} flagged (large or possible duplicate). </>}<Link className="link" href="/payments?status=pending">Review now →</Link></Alert>}
          {d.expenses.pendingOthers.n + d.expenses.pendingDirector.n > 0 && <Alert tone="warn" title={`${d.expenses.pendingOthers.n + d.expenses.pendingDirector.n} expense(s) awaiting approval`}>
            {formatNaira(d.expenses.pendingOthers.s + d.expenses.pendingDirector.s)} · <Link className="link" href="/expenses?status=pending">Review →</Link></Alert>}
          {d.unmatched.count > 0 && can(actor, "recon.view") && <Alert tone="info" title={`${d.unmatched.count} unmatched / duplicate bank line(s)`}><Link className="link" href="/reconciliation">Open reconciliation →</Link></Alert>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Approved collections" value={<N k={d.collections} />} href="/payments?status=approved"
          sub={change === null ? "No collections in previous period" : <span className={change >= 0 ? "text-emerald-700" : "text-rose-700"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% vs previous period ({formatNaira(d.prevCollections)})</span>}
          basis="Approved payments dated in the period. Excludes pending, rejected and reversed." />
        <Stat label="Expected fees" value={<N k={d.fees.expected} />} sub={`Approved paid ${formatNaira(d.fees.paid)}`} href="/reports/fee_collection" basis="Charges assigned (net of waivers) for the selected session/term." />
        <Stat label="Outstanding fees" value={<N k={d.fees.outstanding} />} tone={d.fees.outstanding > 0 ? "warn" : "good"} href="/debtors"
          sub={`Collection rate ${(d.fees.rateTenths / 10).toFixed(1)}% · ${formatNaira(d.fees.pending)} awaiting approval`} basis="Receivable — not cash, not profit." />
        <Stat label="Pending payment approvals" value={d.pending.count} sub={formatNaira(d.pending.total)} tone={d.pending.count ? "warn" : "default"} href="/payments?status=pending" basis="Not yet credited to any balance." />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Cash surplus / (deficit)" value={<N k={d.cash.surplus} />} tone={d.cash.surplus >= 0 ? "good" : "bad"} href={can(actor, "reports.financial") ? `/reports/pnl?from=${from}&to=${to}` : undefined}
          sub={`Income ${formatNaira(d.cash.totalIncome)} − spending ${formatNaira(d.cash.totalExpenses)}${d.cash.marginTenths !== null ? ` · margin ${(d.cash.marginTenths / 10).toFixed(1)}%` : ""}`}
          basis="Cash basis: approved receipts minus paid expenses, salaries and bank charges. Transfers excluded." />
        <Stat label="Expenses paid (period)" value={<N k={d.expenses.paidInRange} />} href="/expenses?status=paid" sub="Excludes payroll" />
        <Stat label="Approved but unpaid expenses" value={<N k={d.expenses.approvedUnpaid} />} tone={d.expenses.approvedUnpaid ? "warn" : "default"} href="/expenses?status=approved" sub={`${d.expenses.approvedUnpaidCount} item(s) — a liability, not yet cash out`} />
        <Stat label="Expenses awaiting approval" value={d.expenses.pendingOthers.n + d.expenses.pendingDirector.n} href="/expenses?status=pending"
          sub={<>Finance/staff: {d.expenses.pendingOthers.n} ({formatNaira(d.expenses.pendingOthers.s)}) · Director: {d.expenses.pendingDirector.n} ({formatNaira(d.expenses.pendingDirector.s)})</>} />
      </div>

      {d.payroll && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={`Payroll ${d.payroll.month}`} value={d.payroll.currentPeriod ? <N k={d.payroll.currentPeriod.net} /> : "Not generated"} href="/payroll/periods"
            sub={d.payroll.currentPeriod ? <>Status <StatusBadge status={String(d.payroll.currentPeriod.status)} /> · paid {formatNaira(d.payroll.currentPeriod.paid)}</> : `Estimated ${formatNaira(d.payroll.upcomingEstimate)} for ${d.payroll.activeStaff} staff`} />
          <Stat label="Unpaid salaries (this period)" value={d.payroll.currentPeriod && ["approved", "partially_paid", "paid"].includes(d.payroll.currentPeriod.status) ? <N k={d.payroll.currentPeriod.net - d.payroll.currentPeriod.paid} /> : "—"}
            sub={d.payroll.currentPeriod && !["approved", "partially_paid", "paid"].includes(d.payroll.currentPeriod.status) ? "Payroll not yet approved — not a liability yet" : undefined} />
          <Stat label="Salary arrears (earlier periods)" value={<N k={d.payroll.arrears} />} tone={d.payroll.arrears ? "bad" : "default"} />
          <Stat label="Salaries paid (period)" value={<N k={d.payroll.paidInRange} />} sub={`Upcoming estimate ${formatNaira(d.payroll.upcomingEstimate)} / month`} />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Revenue vs expenses (last 6 months, cash basis)" className="xl:col-span-2">
          <TrendChart data={d.trend} series={[{ key: "income", label: "Income" }, { key: "expense", label: "Expenses" }]} />
        </Card>
        {d.balances.length > 0 && (
          <Card title="Account balances" actions={<Link className="link text-xs" href="/accounts">All accounts</Link>}>
            <ul className="divide-y divide-slate-100 text-sm">
              {d.balances.filter((b) => b.active).map((b) => (
                <li key={b.id} className="py-2">
                  <div className="flex justify-between"><Link href={`/accounts/${b.id}`} className="link">{b.name}</Link><N k={b.bookBalance} className="font-semibold" /></div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{b.type.toUpperCase()} {b.accountNumberMasked}</span>
                    <span>{b.lastReconciledDate ? <>Statement {formatNaira(b.lastReconciledBalance)} @ {b.lastReconciledDate.split("-").reverse().join("/")}</> : "Not yet reconciled"}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-slate-400">Book balance = opening + all approved/posted transactions. Statement balance = last reconciliation.</p>
          </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Income breakdown (period)"><HBar data={d.cash.income.slice(0, 8).map((x) => ({ label: x.category, value: x.amount }))} /></Card>
        <Card title="Expense breakdown (period)"><HBar data={d.cash.expenses.slice(0, 8).map((x) => ({ label: x.category, value: x.amount }))} /></Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Outstanding fees by class" actions={<Link className="link text-xs" href="/debtors">Debtors</Link>}>
          {d.debtorsByClass.length ? (
            <table><tbody>{d.debtorsByClass.map((c) => (
              <tr key={c.className}><td className="td w-28">{c.className}</td><td className="td"><Bar value={c.outstanding} max={Math.max(...d.debtorsByClass.map((x) => x.outstanding))} tone="rose" /></td>
                <td className="td num">{formatNaira(c.outstanding)}</td><td className="td num text-xs text-slate-500">{c.students} pupils</td></tr>))}</tbody></table>
          ) : <p className="text-sm text-slate-500">No outstanding balances.</p>}
        </Card>
        <Card title="Top outstanding balances">
          <table><tbody>{d.topDebtors.map((t) => (
            <tr key={t.studentId}><td className="td"><Link href={`/students/${t.studentId}`} className="link">{t.studentName}</Link><div className="text-xs text-slate-500">{t.admissionNo} · {t.className}</div></td>
              <td className="td num font-medium">{formatNaira(t.outstanding)}</td><td className="td text-xs">{t.ageing}</td></tr>))}</tbody></table>
          {!d.topDebtors.length && <p className="text-sm text-slate-500">No debtors.</p>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Top revenue categories">
          {d.cash.income.slice(0, 6).map((x) => (<div key={x.category} className="mb-2 text-sm"><div className="flex justify-between"><span>{x.category}</span><span className="tabular-nums">{formatNaira(x.amount)} <span className="text-xs text-slate-500">({pct(x.amount, d.cash.totalIncome)})</span></span></div><Bar value={x.amount} max={d.cash.income[0]?.amount ?? 1} /></div>))}
          {!d.cash.income.length && <p className="text-sm text-slate-500">No income recorded in this period.</p>}
        </Card>
        <Card title="Recent financial activity" actions={can(actor, "audit.view") ? <Link className="link text-xs" href="/audit">Audit log</Link> : undefined}>
          <ul className="divide-y divide-slate-100 text-sm">
            {d.recent.map((r, i) => (<li key={i} className="flex justify-between gap-2 py-1.5"><span><span className="font-medium">{String(r.user_name)}</span> · {String(r.action).replace(/_/g, " ")} <span className="text-xs text-slate-500">{String(r.record_type ?? "")} #{String(r.record_id ?? "")}</span></span><span className="text-xs text-slate-500"><DT d={r.at as Date} /></span></li>))}
          </ul>
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-400">All figures are calculated live from posted records. Collections count only Director-approved payments. Surplus is cash-based (see Income & expenditure for the accrual-style view); outstanding fees and unpaid liabilities are shown separately and are never counted as cash or profit.</p>
    </>
  );
}
