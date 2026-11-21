import Link from "next/link";
import { requireAnyPage } from "@/server/session";
import { runReport } from "@/server/reports";
import { listExpenseCategories, listVendors } from "@/server/services/expenses";
import { listAccounts } from "@/server/services/accounts";
import { listUsers } from "@/server/services/admin";
import { DataTable, FilterBar, SP, flat, sp1 } from "@/components/DataTable";
import { PageHeader, Tabs, N, StatusBadge, Badge } from "@/components/ui";
import { can } from "@/server/actor";

export const metadata = { title: "Expenses" };
export default async function Expenses({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requireAnyPage("expenses.view", "expenses.create", "expenses.approve");
  const sp = await searchParams;
  const p = flat(sp);
  const r = await runReport(a, "expenses", p);
  const all = await runReport(a, "expenses", { ...p, status: undefined });
  const [cats, vendors, accs, users] = await Promise.all([listExpenseCategories(), listVendors(), listAccounts(), listUsers()]);
  const status = sp1(sp, "status") ?? "";
  const count = (s: string) => all.rows.filter((x) => x.status === s).length;
  const tab = (s: string, l: string) => ({ key: s || "all", label: l, count: s ? count(s) : all.rows.length, href: `/expenses?${new URLSearchParams({ ...Object.fromEntries(Object.entries(p).filter(([k, v]) => v && !["status", "page"].includes(k))) as Record<string, string>, ...(s ? { status: s } : {}) })}` });
  return (
    <>
      <PageHeader title="Expenses" subtitle="Submitted → approved → paid are separate steps. Only paid expenses are cash outflows."
        actions={<>{can(a, "expenses.manage_categories") && <Link className="btn-secondary" href="/expenses/categories">Categories & vendors</Link>}{can(a, "expenses.create") && <Link className="btn-primary" href="/expenses/new">Record expense</Link>}</>} />
      <Tabs current={status || "all"} tabs={[tab("pending", "Pending approval"), tab("approved", "Approved, unpaid"), tab("paid", "Paid"), tab("rejected", "Rejected"), tab("draft", "Drafts"), tab("cancelled", "Cancelled"), tab("reversed", "Reversed"), tab("", "All")]} />
      <FilterBar path="/expenses" sp={sp} keep={["status"]} fields={[
        { name: "q", label: "Search", placeholder: "No., title, payee, reference" },
        { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "basis", label: "Date basis", type: "select", options: [{ value: "incurred", label: "Date incurred" }, { value: "paid", label: "Date paid" }] },
        { name: "categoryId", label: "Category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { name: "vendorId", label: "Vendor", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
        { name: "payee", label: "Payee contains" },
        { name: "accountId", label: "Account", type: "select", options: accs.map((x) => ({ value: x.id, label: x.name })) },
        { name: "entrant", label: "Entered by role", type: "select", options: [{ value: "director", label: "Director" }, { value: "other", label: "Finance / other staff" }] },
        { name: "createdBy", label: "Entered by", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
        { name: "approvedBy", label: "Approver", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
        { name: "recurring", label: "Recurring only", type: "checkbox" },
      ]} />
      <DataTable path="/expenses" sp={sp} rows={r.rows} exportKey="expenses" canExport={r.canExport} exportParams={p} rowHref={(x) => `/expenses/${x.id}`}
        totals={{ expenseNo: "Total", amount: <N k={(r.totals as { amount: number }).amount} /> }}
        columns={[{ key: "expenseNo", label: "No." }, { key: "dateIncurred", label: "Date", type: "date" }, { key: "title", label: "Title", render: (x) => <>{String(x.title)}{x.recurring ? <span className="ml-1"><Badge tone="sky">recurring</Badge></span> : null}</> },
          { key: "categoryName", label: "Category" }, { key: "payee", label: "Payee", hideOnMobile: true }, { key: "amount", label: "Amount", type: "money" },
          { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status === "approved" ? "approved" : String(x.status)} /> },
          { key: "createdByName", label: "Entered by", hideOnMobile: true, render: (x) => <span className="text-xs">{String(x.createdByName)}{x.createdByDirector ? <> <Badge tone="indigo">Director</Badge></> : null}</span> },
          { key: "approvedByName", label: "Approver", hideOnMobile: true }, { key: "paidDate", label: "Paid", type: "date", hideOnMobile: true }]} />
    </>
  );
}
