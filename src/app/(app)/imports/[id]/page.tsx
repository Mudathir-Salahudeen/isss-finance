import { requireAnyPage } from "@/server/session";
import { getImportBatch } from "@/server/services/imports";
import { PageHeader, Card, DL, DT, StatusBadge } from "@/components/ui";

export default async function ImportBatch({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireAnyPage("students.import", "payroll.manage_staff", "fees.assign", "fees.opening_balance", "audit.view");
  const id = Number((await params).id);
  const b = await getImportBatch(a, id);
  const failed = (b.rowResults ?? []).filter((r) => r.outcome === "failed");
  return (
    <>
      <PageHeader title={`Import summary — ${b.fileName}`} back={{ href: "/imports", label: "Imports" }}
        actions={<><a className="btn-secondary" href={`/api/export/import_failed?batchId=${id}&all=1&format=xlsx`}>All rows (Excel)</a>{failed.length > 0 && <a className="btn-primary" href={`/api/export/import_failed?batchId=${id}&format=xlsx`}>Download failed rows with errors</a>}</>} />
      <Card className="mb-4"><DL cols={4} items={[["Type", b.kind], ["Uploaded", <DT key="d" d={b.createdAt} />], ["Rows in file", b.totalRows], ["Outcome", <StatusBadge key="s" status={b.status} />], ["Imported (new)", b.createdCount], ["Updated", b.updatedCount], ["Skipped", b.skippedCount], ["Failed", b.failedCount]]} /></Card>
      <Card title="Row results" pad={false}>
        <div className="max-h-[32rem] overflow-auto"><table><thead><tr><th className="th">Row</th><th className="th">Outcome</th><th className="th">Message</th><th className="th">Data</th></tr></thead>
          <tbody>{(b.rowResults ?? []).map((r) => (<tr key={r.row} className={r.outcome === "failed" ? "bg-rose-50" : r.outcome === "skipped" ? "bg-slate-50" : ""}><td className="td">{r.row}</td><td className="td">{r.outcome}</td><td className="td text-xs">{r.message}</td><td className="td text-xs text-slate-500">{Object.values(r.data).filter(Boolean).slice(0, 6).join(" · ")}</td></tr>))}</tbody></table></div>
      </Card>
    </>
  );
}
