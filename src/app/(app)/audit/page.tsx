import { requirePage } from "@/server/session";
import { listAudit, auditModules } from "@/server/services/auditlog";
import { listUsers } from "@/server/services/admin";
import { PageHeader } from "@/components/ui";
import { DataTable, FilterBar, SP, flat } from "@/components/DataTable";
import { can } from "@/server/actor";
import { parseDateInput } from "@/lib/dates";

export const metadata = { title: "Audit log" };
export default async function Audit({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("audit.view");
  const sp = await searchParams;
  const p = flat(sp);
  const rows = await listAudit(a, { from: parseDateInput(p.from) ?? undefined, to: parseDateInput(p.to) ?? undefined, userId: Number(p.userId) || undefined, module: p.module, action: p.action, recordType: p.recordType, recordId: p.recordId, q: p.q }, 3000);
  const [mods, users] = await Promise.all([auditModules(), listUsers()]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only: entries cannot be edited or deleted (enforced by the database)." />
      <FilterBar path="/audit" sp={sp} fields={[{ name: "q", label: "Search", placeholder: "Action, user, reason, values" }, { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "userId", label: "User", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })) }, { name: "module", label: "Module", type: "select", options: mods.map((m) => ({ value: m, label: m })) },
        { name: "action", label: "Action contains" }, { name: "recordType", label: "Record type" }, { name: "recordId", label: "Record / transaction ID" }]} />
      <DataTable path="/audit" sp={sp} rows={rows as unknown as Record<string, unknown>[]} exportKey="audit" canExport={can(a, "reports.export_sensitive")} exportParams={p} pageSize={50}
        columns={[{ key: "at", label: "When", type: "datetime" }, { key: "userName", label: "User" }, { key: "module", label: "Module" }, { key: "action", label: "Action", render: (r) => String(r.action).replace(/_/g, " ") },
          { key: "recordType", label: "Record", render: (r) => r.recordType ? `${r.recordType} #${r.recordId}` : "—" }, { key: "reason", label: "Reason", hideOnMobile: true },
          { key: "newValues", label: "Details", sortable: false, hideOnMobile: true, render: (r) => (r.oldValues || r.newValues) ? <details className="max-w-md text-xs"><summary className="cursor-pointer text-brand-700">View changes</summary>
            {r.oldValues ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-rose-50 p-2">{JSON.stringify(r.oldValues, null, 1).slice(0, 2000)}</pre> : null}
            {r.newValues ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-brand-50 p-2">{JSON.stringify(r.newValues, null, 1).slice(0, 2000)}</pre> : null}</details> : null },
          { key: "ip", label: "IP", hideOnMobile: true }]} />
    </>
  );
}
