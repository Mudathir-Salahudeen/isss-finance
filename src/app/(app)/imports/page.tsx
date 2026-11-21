import Link from "next/link";
import { requireAnyPage } from "@/server/session";
import { listImportBatches } from "@/server/services/imports";
import { PageHeader, Card, StatusBadge, DT } from "@/components/ui";
import { can } from "@/server/actor";

export const metadata = { title: "Imports" };
export default async function Imports() {
  const a = await requireAnyPage("students.import", "payroll.manage_staff", "fees.assign", "fees.opening_balance", "audit.view");
  const rows = await listImportBatches(a);
  const kinds = [["students", "Students", "students.import"], ["staff", "Staff", "payroll.manage_staff"], ["fee_assignments", "Fee assignments", "fees.assign"], ["opening_balances", "Opening balances", "fees.opening_balance"]].filter((k) => can(a, k[2]));
  return (
    <>
      <PageHeader title="Imports & templates" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kinds.map(([k, l]) => (
          <div key={k} className="card p-4"><div className="font-medium">{l}</div><div className="mt-2 flex gap-2"><Link href={`/imports/new?kind=${k}`} className="btn-primary btn-sm">Import</Link><a href={`/api/templates/${k}`} className="btn-secondary btn-sm">Template</a></div></div>
        ))}
        <div className="card p-4"><div className="font-medium">Bank statement</div><div className="mt-2 flex gap-2"><Link href="/reconciliation/import" className="btn-primary btn-sm">Import</Link><a href="/api/templates/bank_statement" className="btn-secondary btn-sm">Template</a></div></div>
      </div>
      <Card title="Import log" pad={false}>
        <table><thead><tr>{["When", "Type", "File", "Uploaded by", "Rows", "Created", "Updated", "Skipped", "Failed", "Outcome"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.id)}><td className="td"><Link className="link" href={`/imports/${r.id}`}><DT d={r.created_at as Date} /></Link></td><td className="td">{String(r.kind)}</td><td className="td">{String(r.file_name)}</td><td className="td">{String(r.uploaded_by)}</td>
              {["total_rows", "created_count", "updated_count", "skipped_count", "failed_count"].map((k) => <td key={k} className="td num">{String(r[k])}</td>)}<td className="td"><StatusBadge status={String(r.status)} /></td></tr>))}</tbody></table>
        {!rows.length && <p className="p-4 text-sm text-slate-500">No imports yet.</p>}
      </Card>
    </>
  );
}
