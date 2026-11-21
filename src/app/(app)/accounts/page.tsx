import Link from "next/link";
import { requirePage } from "@/server/session";
import { runReport } from "@/server/reports";
import { listUsers } from "@/server/services/admin";
import { PageHeader, Card, N, Badge } from "@/components/ui";
import { ActionForm } from "@/components/client/forms";
import { AccountFields } from "@/components/AccountForm";
import { accountAction } from "./actions";
import { can } from "@/server/actor";
import { formatNaira } from "@/lib/money";

export const metadata = { title: "Accounts" };
export default async function Accounts() {
  const a = await requirePage("accounts.view");
  const r = await runReport(a, "accounts", {});
  const rows = r.rows as { id: number; name: string; type: string; provider: string; accountNumberMasked: string; bookBalance: number; lastReconciledBalance: number | null; lastReconciledDate: string | null; unmatchedLines: number; active: boolean }[];
  return (
    <>
      <PageHeader title="Bank, cash & POS accounts" subtitle="Book balance = opening balance + all posted transactions. Statement balances come from reconciliation."
        actions={<><Link className="btn-secondary" href="/accounts/transfers">Transfers</Link>{r.canExport && <a className="btn-secondary" href="/api/export/accounts?format=xlsx">Excel</a>}</>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((x) => (
          <Link key={x.id} href={`/accounts/${x.id}`} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between"><Badge tone={x.type === "cash" ? "amber" : x.type === "pos" ? "sky" : "emerald"}>{x.type.toUpperCase()}</Badge>{!x.active && <Badge>Inactive</Badge>}</div>
            <div className="mt-3 text-2xl font-semibold tabular-nums"><N k={x.bookBalance} /></div>
            <div className="mt-1 text-sm font-medium text-slate-800">{x.name}</div>
            <div className="text-xs text-slate-500">{x.provider} {x.accountNumberMasked}</div>
            <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">{x.lastReconciledDate ? `Statement ${formatNaira(x.lastReconciledBalance)} at ${x.lastReconciledDate.split("-").reverse().join("/")}` : "Not yet reconciled"}{x.unmatchedLines ? ` · ${x.unmatchedLines} unmatched` : ""}</div>
          </Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-slate-600">Total book balance across accounts: <b><N k={(r.totals as { bookBalance: number }).bookBalance} /></b></p>
      {can(a, "accounts.manage") && <Card title="Register a new account"><ActionForm action={accountAction}><AccountFields users={(await listUsers()).filter((u) => u.isActive)} /></ActionForm></Card>}
    </>
  );
}
