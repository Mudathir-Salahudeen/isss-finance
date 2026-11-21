import Link from "next/link";
import { requirePage } from "@/server/session";
import { listFees, listFeeCategories } from "@/server/services/fees";
import { getStructure } from "@/server/services/academics";
import { DataTable, FilterBar, SP, sp1 } from "@/components/DataTable";
import { PageHeader, Card, N } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { categoryAction } from "./actions";
import { can } from "@/server/actor";

export const metadata = { title: "Fees" };
export default async function Fees({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("fees.view");
  const sp = await searchParams;
  const st = await getStructure();
  const cats = await listFeeCategories();
  const sessionId = sp1(sp, "sessionId") === "all" ? undefined : Number(sp1(sp, "sessionId")) || st.sessions.find((s) => s.isCurrent)?.id;
  const rows = await listFees({ sessionId, termId: Number(sp1(sp, "termId")) || undefined, status: sp1(sp, "status"), categoryId: Number(sp1(sp, "categoryId")) || undefined });
  return (
    <>
      <PageHeader title="Fee setup" subtitle="Create any fee at any time, then assign it to classes, arms or individual students."
        actions={<>{can(a, "reports.view") && <Link className="btn-secondary" href="/reports/fee_collection">Collection performance</Link>}{can(a, "fees.manage") && <Link className="btn-primary" href="/fees/new">New fee</Link>}</>} />
      <FilterBar path="/fees" sp={sp} fields={[
        { name: "sessionId", label: "Session", type: "select", options: [{ value: "all", label: "All sessions" }, ...st.sessions.map((s) => ({ value: s.id, label: s.name }))] },
        { name: "termId", label: "Term", type: "select", options: st.terms.map((t) => ({ value: t.id, label: `${t.name} ${st.sessions.find((s) => s.id === t.sessionId)?.name}` })) },
        { name: "categoryId", label: "Category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { name: "status", label: "Status", type: "select", options: ["draft", "active", "inactive", "cancelled"].map((s) => ({ value: s, label: s })) },
      ]} />
      <DataTable path="/fees" sp={sp} rows={rows as unknown as Record<string, unknown>[]} rowHref={(r) => `/fees/${r.id}`}
        totals={{ name: "Total", expected: <N k={rows.reduce((t, r) => t + r.expected, 0)} /> }}
        columns={[{ key: "name", label: "Fee" }, { key: "categoryName", label: "Category" }, { key: "sessionName", label: "Session" }, { key: "termName", label: "Term" },
          { key: "amount", label: "Default amount", type: "money" }, { key: "dueDate", label: "Due", type: "date" }, { key: "mandatory", label: "Type", render: (r) => (r.mandatory ? "Mandatory" : "Optional") },
          { key: "chargeCount", label: "Students", type: "number" }, { key: "expected", label: "Expected", type: "money" }, { key: "status", label: "Status", type: "status" }]} />
      <Card title="Fee categories (income reporting)" className="mt-4">
        <div className="mb-3 flex flex-wrap gap-1.5">{cats.map((c) => <span key={c.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{c.name}</span>)}</div>
        {can(a, "fees.manage") && <ActionForm action={categoryAction} resetOnSuccess className="flex gap-2"><input name="name" placeholder="New category, e.g. Robotics Club" className="max-w-xs" required aria-label="New category" /><Submit className="btn-secondary">Add category</Submit></ActionForm>}
      </Card>
    </>
  );
}
