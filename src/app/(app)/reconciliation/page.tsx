import Link from "next/link";
import { requirePage } from "@/server/session";
import { accountBalances } from "@/server/services/accounts";
import { listReconciliations, listStatements } from "@/server/services/recon";
import { PageHeader, Card, N, D, DT, StatusBadge, Badge, Alert } from "@/components/ui";
import { can } from "@/server/actor";

export const metadata = { title: "Reconciliation" };
export default async function Recon() {
  const a = await requirePage("recon.view");
  const [accs, recs, stmts] = await Promise.all([accountBalances(), listReconciliations(a), listStatements()]);
  return (
    <>
      <PageHeader title="Bank & cash reconciliation" subtitle="Match imported bank statements to the book, record bank charges, and lock reconciled periods."
        actions={can(a, "recon.manage") ? <Link className="btn-primary" href="/reconciliation/import">Import bank statement</Link> : undefined} />
      <div className="mb-4"><Alert tone="info">Bank integrations are <b>not connected</b>. Statements are imported from CSV/Excel files exported from your bank. Matching a bank credit to a pending payment never approves it.</Alert></div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {accs.filter((x) => x.active).map((x) => (
          <Link key={x.id} href={`/reconciliation/account/${x.id}`} className="card block p-5 hover:shadow-md">
            <div className="flex justify-between"><span className="font-medium">{x.name}</span><Badge tone={x.type === "cash" ? "amber" : "emerald"}>{x.type}</Badge></div>
            <div className="mt-2 text-xl font-semibold"><N k={x.bookBalance} /></div><div className="text-xs text-slate-400">Book balance</div>
            <div className="mt-2 text-xs">{x.unmatchedLines ? <span className="text-rose-600">{x.unmatchedLines} unmatched line(s)</span> : <span className="text-slate-500">No unmatched lines</span>}</div>
            <div className="text-xs text-slate-500">{x.lastReconciledDate ? <>Reconciled to <D d={x.lastReconciledDate} /></> : "Never reconciled"}</div>
          </Link>))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reconciliation periods" pad={false} actions={<a className="btn-secondary btn-sm" href="/api/export/reconciliations?format=pdf" target="_blank">PDF</a>}>
          <table><thead><tr>{["Account", "Period", "Statement", "Book", "Difference", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{recs.map(({ r, accountName }) => <tr key={r.id}><td className="td"><Link className="link" href={`/reconciliation/${r.id}`}>{accountName}</Link></td><td className="td text-xs"><D d={r.periodStart} /> – <D d={r.periodEnd} /></td>
              <td className="td num"><N k={r.statementBalance} /></td><td className="td num"><N k={r.bookBalance} /></td><td className="td num"><N k={r.difference} /></td><td className="td"><StatusBadge status={r.status} /></td></tr>)}</tbody></table>
          {!recs.length && <p className="p-5 text-sm text-slate-500">No reconciliations yet.</p>}
        </Card>
        <Card title="Imported statements" pad={false}>
          <table><thead><tr>{["Uploaded", "Account", "File", "Lines", "Duplicates"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{stmts.map(({ s, accountName, by }) => <tr key={s.id}><td className="td text-xs"><DT d={s.uploadedAt} /><br />{by}</td><td className="td">{accountName}</td><td className="td text-xs">{s.fileName}</td><td className="td num">{s.lineCount}</td><td className="td num">{s.duplicateCount}</td></tr>)}</tbody></table>
          {!stmts.length && <p className="p-5 text-sm text-slate-500">No statements imported yet.</p>}
        </Card>
      </div>
    </>
  );
}
