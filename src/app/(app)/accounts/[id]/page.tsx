import { requirePage } from "@/server/session";
import { runReport } from "@/server/reports";
import { listUsers } from "@/server/services/admin";
import { db } from "@/db";
import { accounts, accountUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PageHeader, Card, N } from "@/components/ui";
import { DataTable, FilterBar, SP, flat } from "@/components/DataTable";
import { ActionForm } from "@/components/client/forms";
import { AccountFields } from "@/components/AccountForm";
import { accountAction } from "../actions";
import { can } from "@/server/actor";
import { maskAccountNumber } from "@/server/services/accounts";
import Link from "next/link";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const a = await requirePage("accounts.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!acc) notFound();
  const p = { ...flat(sp), accountId: String(id) };
  const r = await runReport(a, "account_txns", p);
  const t = r.totals as Record<string, number>;
  return (
    <>
      <PageHeader title={acc.name} back={{ href: "/accounts", label: "Accounts" }} subtitle={`${acc.type.toUpperCase()} · ${acc.provider ?? ""} ${maskAccountNumber(acc.accountNumber)}`}
        actions={can(a, "recon.view") ? <Link className="btn-secondary" href={`/reconciliation/account/${id}`}>Reconcile</Link> : undefined} />
      <FilterBar path={`/accounts/${id}`} sp={sp} fields={[{ name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" }]} />
      <DataTable title="Account transactions" path={`/accounts/${id}`} sp={sp} rows={r.rows} exportKey="account_txns" canExport={r.canExport} exportParams={p} pageSize={50}
        totals={{ txnDate: "Closing", moneyIn: <N k={t.moneyIn} />, moneyOut: <N k={t.moneyOut} />, runningBalance: <N k={t.runningBalance} /> }}
        columns={[{ key: "txnDate", label: "Date", type: "date", sortable: false }, { key: "kind", label: "Type", sortable: false, render: (x) => String(x.kind ?? "").replace(/_/g, " ") },
          { key: "description", label: "Description", sortable: false }, { key: "reference", label: "Ref.", sortable: false }, { key: "moneyIn", label: "In", type: "money", sortable: false },
          { key: "moneyOut", label: "Out", type: "money", sortable: false }, { key: "runningBalance", label: "Balance", type: "money", sortable: false },
          { key: "reconciled", label: "Matched", sortable: false, render: (x) => (x.reconciled ? "✓" : "") }]} />
      {can(a, "accounts.manage") && <Card title="Edit account" className="mt-4"><ActionForm action={accountAction}><AccountFields acc={acc} users={(await listUsers()).filter((u) => u.isActive)} assigned={(await db.select().from(accountUsers).where(eq(accountUsers.accountId, id))).map((x) => x.userId)} /></ActionForm></Card>}
    </>
  );
}
