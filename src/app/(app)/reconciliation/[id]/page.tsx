import Link from "next/link";
import { requirePage } from "@/server/session";
import { getReconciliation } from "@/server/services/recon";
import { PageHeader, Card, N, D, DT, StatusBadge, Alert, DL } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { refreshRecAction, completeRecAction, reopenRecAction } from "../actions";
import { can } from "@/server/actor";
import { formatNaira } from "@/lib/money";

export default async function RecPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requirePage("recon.view");
  const id = Number((await params).id);
  const d = await getReconciliation(a, id);
  const r = d.rec;
  const liveDiff = (r.statementBalance ?? 0) - d.liveBook;
  const open = r.status !== "reconciled";
  return (
    <>
      <PageHeader title={`Reconciliation — ${d.account.name}`} back={{ href: "/reconciliation", label: "Reconciliation" }} subtitle={<><D d={r.periodStart} /> to <D d={r.periodEnd} /> · <StatusBadge status={r.status} /></>}
        actions={<><Link className="btn-secondary" href={`/reconciliation/account/${r.accountId}?from=${r.periodStart}&to=${r.periodEnd}`}>Open workspace</Link><a className="btn-secondary" href={`/api/export/reconciliations?accountId=${r.accountId}&format=pdf`} target="_blank">PDF report</a></>} />
      {r.status === "reconciled" && <div className="mb-4"><Alert tone="success" title="Reconciled and locked">By {d.reconciledByName} on <DT d={r.reconciledAt} />. No transactions can be posted into this period for this account unless it is reopened.</Alert></div>}
      {r.status === "reopened" && <div className="mb-4"><Alert tone="warn" title="Reopened">{r.reopenReason} — {d.reopenedByName}, <DT d={r.reopenedAt} /></Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={r.statementBalance} /></div><div className="text-xs uppercase text-slate-400">{d.account.type === "cash" ? "Counted cash" : "Statement balance"}</div></div>
        <div className="card p-5"><div className="text-2xl font-semibold"><N k={open ? d.liveBook : r.bookBalance} /></div><div className="text-xs uppercase text-slate-400">Book balance at period end</div></div>
        <div className="card p-5"><div className={`text-2xl font-semibold ${(open ? liveDiff : r.difference) ? "text-rose-600" : "text-brand-700"}`}><N k={open ? liveDiff : r.difference} /></div><div className="text-xs uppercase text-slate-400">Difference</div></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Summary" className="lg:col-span-2">
          <DL cols={3} items={[["Opening (book)", <N key="o" k={d.cash.opening} />], ["Fee collections", <N key="c" k={d.cash.collections} />], ["Transfers in", <N key="i" k={d.cash.receivedIn} />],
            ["Disbursements", <N key="d" k={d.cash.disbursements} />], ["Transfers out / deposits", <N key="t" k={d.cash.deposits} />], ["Closing (book)", <N key="cl" k={d.cash.closing} />],
            ["Unmatched statement credits", d.ws.summary.unmatchedCredits.length], ["Unmatched statement debits", d.ws.summary.unmatchedDebits.length], ["Book entries not on statement", d.ws.summary.unmatchedBook.length],
            ["Prepared by", d.createdByName], ["Notes", r.notes || "—"]]} />
          {d.ws.summary.unmatchedCredits.concat(d.ws.summary.unmatchedDebits).length > 0 && (
            <div className="mt-4"><h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Unmatched statement lines</h3>
              <ul className="text-sm">{d.ws.summary.unmatchedCredits.concat(d.ws.summary.unmatchedDebits).map((l) => <li key={String(l.id)}>{String(l.line_date)} · {formatNaira(l.amount)} · {String(l.description)}</li>)}</ul></div>)}
        </Card>
        {can(a, "recon.manage") && (
          <Card title="Actions">
            {open ? (
              <div className="space-y-3">
                <ActionForm action={refreshRecAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                  <label htmlFor="sb" className="mb-1 block">{d.account.type === "cash" ? "Counted cash" : "Statement balance"} (₦)</label><input id="sb" name="statementBalance" defaultValue={((r.statementBalance ?? 0) / 100).toFixed(2)} />
                  <Submit className="btn-secondary">Update & recalculate</Submit></ActionForm>
                <ReasonAction action={completeRecAction} className="btn-primary" label="Reconcile & lock period" title="Lock this period" reasonLabel="Note (required if unmatched lines remain)" hidden={{ id }}
                  description="Allowed only when the difference is ₦0.00. Once locked, nothing can be posted into this period for this account." />
              </div>
            ) : can(a, "recon.reopen") ? (
              <ReasonAction action={reopenRecAction} label="Reopen period" title="Reopen reconciled period" hidden={{ id }} description="Reopening is recorded in the audit log with your reason." />
            ) : <p className="text-sm text-slate-500">Reopening requires the recon.reopen permission.</p>}
          </Card>
        )}
      </div>
    </>
  );
}
