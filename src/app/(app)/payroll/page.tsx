import Link from "next/link";
import { requirePage } from "@/server/session";
import { runReport } from "@/server/reports";
import { PageHeader, Card, N, Alert } from "@/components/ui";
import { DataTable, SP } from "@/components/DataTable";
import { ActionForm } from "@/components/client/forms";
import { StaffFields } from "@/components/StaffForm";
import { staffAction } from "./actions";
import { can } from "@/server/actor";

export const metadata = { title: "Staff & payroll" };
export default async function Staff({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("payroll.view");
  const sp = await searchParams;
  const r = await runReport(a, "staff", {});
  const t = r.totals as Record<string, number>;
  return (
    <>
      <PageHeader title="Staff & salaries" subtitle="Confidential — visible only to roles with payroll permission."
        actions={<><Link className="btn-secondary" href="/payroll/periods">Payroll periods</Link>{can(a, "payroll.manage_staff") && <Link className="btn-secondary" href="/imports/new?kind=staff">Import staff</Link>}</>} />
      <div className="mb-4"><Alert tone="info">Statutory deductions (PAYE, pension, NHF, etc.) are not hard-coded. Configure them per staff member as deduction items, using rates validated for your school.</Alert></div>
      <DataTable path="/payroll" sp={sp} rows={r.rows} exportKey="staff" canExport={r.canExport} rowHref={(x) => `/payroll/staff/${x.id}`}
        totals={{ staffNo: "Total", basic: <N k={t.basic} />, allowances: <N k={t.allowances} />, deductions: <N k={t.deductions} />, loanBalance: <N k={t.loanBalance} /> }}
        columns={r.columns.map((c) => ({ key: c.key, label: c.label, type: c.key === "status" ? "status" : c.type }))} />
      {can(a, "payroll.manage_staff") && <Card title="Add staff member" className="mt-4"><ActionForm action={staffAction}><StaffFields /></ActionForm></Card>}
    </>
  );
}
