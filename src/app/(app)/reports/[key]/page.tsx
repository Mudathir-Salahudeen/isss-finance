import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/server/session";
import { REPORTS, runReport } from "@/server/reports";
import { getStructure } from "@/server/services/academics";
import { listAccounts } from "@/server/services/accounts";
import { listUsers } from "@/server/services/admin";
import { listFees, listFeeCategories } from "@/server/services/fees";
import { auditModules } from "@/server/services/auditlog";
import { PageHeader, N } from "@/components/ui";
import { DataTable, FilterBar, FilterField, SP, flat } from "@/components/DataTable";
import { ForbiddenError } from "@/lib/errors";

export default async function Report({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const a = await requirePage("dashboard.view");
  let key = (await params).key;
  if (key === "expenses_list") key = "expenses";
  if (key === "debtors") redirect("/debtors");
  if (!REPORTS[key] || ["account_txns", "statement", "import_failed", "payroll_lines"].includes(key)) notFound();
  const sp = await searchParams;
  const p = flat(sp);
  let r;
  try { r = await runReport(a, key, p); } catch (e) { if (e instanceof ForbiddenError) redirect(`/forbidden?perm=${REPORTS[key].perms.join("|")}`); throw e; }
  const st = await getStructure();
  const date: FilterField[] = [{ name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" }];
  const ses: FilterField = { name: "sessionId", label: "Session", type: "select", options: st.sessions.map((s) => ({ value: s.id, label: s.name })) };
  const term: FilterField = { name: "termId", label: "Term", type: "select", options: st.terms.map((t) => ({ value: t.id, label: `${t.name} ${st.sessions.find((s) => s.id === t.sessionId)?.name}` })) };
  const cls: FilterField = { name: "classId", label: "Class", type: "select", options: st.classes.map((c) => ({ value: c.id, label: c.name })) };
  const users = await listUsers();
  const fields: Record<string, FilterField[]> = {
    collections: [{ name: "q", label: "Search" }, ...date, ses, term, cls, { name: "feeId", label: "Fee", type: "select", options: (await listFees({})).map((f) => ({ value: f.id, label: `${f.name} (${f.sessionName})` })) },
      { name: "accountId", label: "Account", type: "select", options: (await listAccounts()).map((x) => ({ value: x.id, label: x.name })) }, { name: "recordedBy", label: "Recorded by", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })) }],
    pending: [{ name: "q", label: "Search" }, ...date, cls], rejected: [{ name: "q", label: "Search" }, ...date],
    fee_collection: [ses, term, cls, { name: "categoryId", label: "Category", type: "select", options: (await listFeeCategories()).map((c) => ({ value: c.id, label: c.name })) }],
    expenses: [{ name: "q", label: "Search" }, ...date, { name: "status", label: "Status", type: "select", options: ["pending", "approved", "paid", "rejected", "cancelled", "reversed"].map((s) => ({ value: s, label: s })) }],
    students: [{ name: "q", label: "Search" }, cls], promotions: [ses, cls, { name: "action", label: "Action", type: "select", options: ["promoted", "repeated", "graduated", "transferred", "withdrawn"].map((s) => ({ value: s, label: s })) }],
    audit: [{ name: "q", label: "Search" }, ...date, { name: "module", label: "Module", type: "select", options: (await auditModules()).map((m) => ({ value: m, label: m })) }, { name: "userId", label: "User", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })) }],
    reconciliations: [{ name: "accountId", label: "Account", type: "select", options: (await listAccounts()).map((x) => ({ value: x.id, label: x.name })) }],
  };
  const totals = r.totals ? Object.fromEntries(Object.entries(r.totals).map(([k, v]) => [k, typeof v === "number" && r.columns.find((c) => c.key === k)?.type === "money" ? <N k={v} /> : String(v ?? "")])) : null;
  return (
    <>
      <PageHeader title={r.def.title} back={{ href: "/reports", label: "Reports" }} subtitle={r.meta?.join(" ")} />
      {fields[key] && <FilterBar path={`/reports/${(await params).key}`} sp={sp} fields={fields[key]} />}
      <DataTable path={`/reports/${(await params).key}`} sp={sp} rows={r.rows} exportKey={key} canExport={r.canExport} exportParams={p} totals={totals} pageSize={50}
        columns={r.columns.map((c) => ({ key: c.key, label: c.label, type: c.key === "status" ? "status" : c.type }))} />
    </>
  );
}
