import Link from "next/link";
import { requirePage } from "@/server/session";
import { getStructure } from "@/server/services/academics";
import { listFees, listFeeCategories } from "@/server/services/fees";
import { runReport } from "@/server/reports";
import { ageingLabels } from "@/server/services/ledger";
import { getSettings } from "@/server/services/admin";
import { DataTable, FilterBar, SP, flat } from "@/components/DataTable";
import { PageHeader, N, StatusBadge } from "@/components/ui";

export const metadata = { title: "Debtors" };
export default async function Debtors({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("debtors.view");
  const sp = await searchParams;
  const st = await getStructure();
  const p = flat(sp);
  if (p.sessionId === undefined) p.sessionId = String(st.sessions.find((s) => s.isCurrent)?.id ?? "");
  if (p.sessionId === "all") p.sessionId = undefined;
  const r = await runReport(a, "debtors", p);
  const [fees, cats, settings] = await Promise.all([listFees({}), listFeeCategories(), getSettings()]);
  const t = r.totals as Record<string, number>;
  return (
    <>
      <PageHeader title="Debtors" subtitle="Balance = charges + adjustments − approved payments. Amounts awaiting approval are shown but do not reduce balances." />
      <FilterBar path="/debtors" sp={{ ...sp, sessionId: p.sessionId ?? "all" }} fields={[
        { name: "q", label: "Search", placeholder: "Name or admission no." },
        { name: "sessionId", label: "Session", type: "select", options: [{ value: "all", label: "All sessions" }, ...st.sessions.map((s) => ({ value: s.id, label: s.name }))] },
        { name: "termId", label: "Term", type: "select", options: st.terms.map((x) => ({ value: x.id, label: `${x.name} ${st.sessions.find((s) => s.id === x.sessionId)?.name}` })) },
        { name: "classId", label: "Class", type: "select", options: st.classes.map((c) => ({ value: c.id, label: c.name })) },
        { name: "armId", label: "Arm", type: "select", options: st.arms.map((x) => ({ value: x.id, label: `${st.classes.find((c) => c.id === x.classId)?.name} ${x.name}` })) },
        { name: "feeId", label: "Fee", type: "select", options: fees.map((f) => ({ value: f.id, label: `${f.name} (${f.sessionName}${f.termName ? " " + f.termName : ""})` })) },
        { name: "categoryId", label: "Fee category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { name: "status", label: "Payment status", type: "select", options: [{ value: "no_payment", label: "No payment" }, { value: "partial", label: "Partial" }, { value: "pending_approval", label: "Pending approval" }, { value: "unpaid", label: "Unpaid" }] },
        { name: "band", label: "Ageing", type: "select", options: ageingLabels(settings.ageingBands).map((l) => ({ value: l, label: l })) },
        { name: "min", label: "Min balance ₦", type: "number" }, { name: "max", label: "Max balance ₦", type: "number" },
        { name: "dueFrom", label: "Due from", type: "date" }, { name: "dueTo", label: "Due to", type: "date" },
        { name: "overdue", label: "Overdue only", type: "checkbox" },
      ]} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><div className="text-2xl font-semibold">{(r.rows.length)}</div><div className="text-xs uppercase text-slate-400">Students owing</div></div>
        <div className="card p-4"><div className="text-2xl font-semibold text-rose-600"><N k={t.outstanding} /></div><div className="text-xs uppercase text-slate-400">Outstanding</div></div>
        <div className="card p-4"><div className="text-2xl font-semibold text-amber-600"><N k={t.overdueAmount} /></div><div className="text-xs uppercase text-slate-400">Overdue</div></div>
        <div className="card p-4"><div className="text-2xl font-semibold"><N k={t.pending} /></div><div className="text-xs uppercase text-slate-400">Awaiting approval</div></div>
      </div>
      <DataTable path="/debtors" sp={sp} rows={r.rows} exportKey="debtors" canExport={r.canExport} exportParams={p} rowHref={(x) => `/students/${x.studentId}`}
        totals={{ admissionNo: "Total", net: <N k={t.net} />, paid: <N k={t.paid} />, pending: <N k={t.pending} />, outstanding: <N k={t.outstanding} />, overdueAmount: <N k={t.overdueAmount} /> }}
        columns={[{ key: "admissionNo", label: "Adm. No." }, { key: "studentName", label: "Student" }, { key: "className", label: "Class", render: (x) => `${x.className ?? ""} ${x.armName ?? ""}` },
          { key: "net", label: "Fees (net)", type: "money" }, { key: "paid", label: "Approved paid", type: "money" }, { key: "pending", label: "Awaiting approval", type: "money", hideOnMobile: true },
          { key: "outstanding", label: "Balance", type: "money" }, { key: "overdueAmount", label: "Overdue", type: "money", hideOnMobile: true }, { key: "ageing", label: "Ageing" },
          { key: "status", label: "Status", render: (x) => <StatusBadge status={String(x.status)} /> },
          { key: "studentId", label: "", sortable: false, render: (x) => <a className="link text-xs" href={`/api/statements/${x.studentId}`} target="_blank" rel="noopener">Statement</a> }]} />
      <p className="mt-3 text-xs text-slate-400">Print the list with the PDF button. Individual statements open as printable PDFs. <Link className="link" href="/reports/fee_collection">Fee collection performance →</Link></p>
    </>
  );
}
