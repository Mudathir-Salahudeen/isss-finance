import { requirePage } from "@/server/session";
import { runReport } from "@/server/reports";
import { PageHeader, Card, N, StatusBadge } from "@/components/ui";
import { DataTable, SP } from "@/components/DataTable";
import { ActionForm, Submit } from "@/components/client/forms";
import { generateAction } from "../actions";
import { can } from "@/server/actor";
import { todayISO } from "@/lib/dates";

export default async function Periods({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("payroll.view");
  const sp = await searchParams;
  const r = await runReport(a, "payroll", {});
  const t = r.totals as Record<string, number>;
  return (
    <>
      <PageHeader title="Payroll periods" back={{ href: "/payroll", label: "Staff" }} subtitle="Generate → adjust → submit → Director approves → record payments → payslips." />
      {can(a, "payroll.prepare") && <Card title="Generate payroll" className="mb-4">
        <ActionForm action={generateAction} className="flex flex-wrap items-end gap-3">
          <div><label htmlFor="pp" className="mb-1 block">Month</label><input id="pp" name="period" type="month" defaultValue={todayISO().slice(0, 7)} required /></div>
          <div><label htmlFor="pd" className="mb-1 block">Pay date</label><input id="pd" name="payDate" type="date" /></div><Submit>Generate</Submit></ActionForm></Card>}
      <DataTable path="/payroll/periods" sp={sp} rows={r.rows} exportKey="payroll" canExport={r.canExport} rowHref={(x) => `/payroll/periods/${x.id}`}
        totals={{ period: "Total", gross: <N k={t.gross} />, deductions: <N k={t.deductions} />, net: <N k={t.net} />, paid: <N k={t.paid} />, unpaid: <N k={t.unpaid} /> }}
        columns={r.columns.map((c) => c.key === "status" ? { key: "status", label: "Status", render: (x: Record<string, unknown>) => <StatusBadge status={String(x.status)} /> } : { key: c.key, label: c.label, type: c.type })} />
    </>
  );
}
