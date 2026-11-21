import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/session";
import { workspace, cashBreakdown, isoOf } from "@/server/services/recon";
import { bookBalance } from "@/server/services/accounts";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader, Card, N, D, StatusBadge, Alert, Field, DL } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { SP, sp1 } from "@/components/DataTable";
import { autoMatchAction, manualMatchAction, unmatchAction, categoriseAction, ignoreAction, startRecAction } from "../../actions";
import { can } from "@/server/actor";
import { formatNaira } from "@/lib/money";
import { todayISO } from "@/lib/dates";

export default async function Workspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const a = await requirePage("recon.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!acc) notFound();
  const from = sp1(sp, "from") ?? `${todayISO().slice(0, 7)}-01`, to = sp1(sp, "to") ?? todayISO();
  const ws = await workspace(a, id, { from: sp1(sp, "from"), to: sp1(sp, "to") });
  const manage = can(a, "recon.manage");
  const isCash = acc.type === "cash";
  const cash = isCash ? await cashBreakdown(id, from, to) : null;
  const book = await bookBalance(id, to);
  const lastBal = [...ws.lines].reverse().find((l) => l.running_balance !== null)?.running_balance as number | undefined;
  const imported = sp1(sp, "imported");
  return (
    <>
      <PageHeader title={`Reconcile — ${acc.name}`} back={{ href: "/reconciliation", label: "Reconciliation" }} subtitle={isCash ? "Cash account: compare counted cash with the book." : "Statement lines (left) vs book transactions (right)."}
        actions={<>{manage && !isCash && <Link className="btn-secondary" href={`/reconciliation/import?accountId=${id}`}>Import statement</Link>}
          {manage && !isCash && <ActionForm action={autoMatchAction}><input type="hidden" name="accountId" value={id} /><input type="hidden" name="from" value={sp1(sp, "from") ?? ""} /><input type="hidden" name="to" value={sp1(sp, "to") ?? ""} /><Submit>Auto-match</Submit></ActionForm>}</>} />
      {imported && <div className="mb-4"><Alert tone="success">{imported} statement line(s) imported{Number(sp1(sp, "dups")) ? `, ${sp1(sp, "dups")} flagged as duplicates` : ""}. Run auto-match next.</Alert></div>}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50/70 p-3">
        <div className="w-40"><label htmlFor="f" className="mb-1 block text-xs">From</label><input id="f" type="date" name="from" defaultValue={sp1(sp, "from")} /></div>
        <div className="w-40"><label htmlFor="t" className="mb-1 block text-xs">To</label><input id="t" type="date" name="to" defaultValue={sp1(sp, "to")} /></div>
        <button className="btn-primary">Apply</button>
      </form>
      {!isCash && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="card p-4"><div className="text-xl font-semibold text-rose-600">{ws.summary.unmatchedCredits.length}</div><div className="text-xs uppercase text-slate-400">Unmatched credits · {formatNaira(ws.summary.unmatchedCredits.reduce((t, l) => t + l.amount, 0))}</div></div>
          <div className="card p-4"><div className="text-xl font-semibold text-rose-600">{ws.summary.unmatchedDebits.length}</div><div className="text-xs uppercase text-slate-400">Unmatched debits · {formatNaira(ws.summary.unmatchedDebits.reduce((t, l) => t + l.amount, 0))}</div></div>
          <div className="card p-4"><div className="text-xl font-semibold text-amber-600">{ws.summary.duplicates.length}</div><div className="text-xs uppercase text-slate-400">Duplicate lines</div></div>
          <div className="card p-4"><div className="text-xl font-semibold">{ws.summary.unmatchedBook.length}</div><div className="text-xs uppercase text-slate-400">Book entries not on statement</div></div>
        </div>
      )}
      {isCash && cash && (
        <Card title="Cash position for the period" className="mb-4">
          <DL cols={3} items={[["Opening cash", <N key="o" k={cash.opening} />], ["Collections", <N key="c" k={cash.collections} />], ["Received from other accounts", <N key="r" k={cash.receivedIn} />],
            ["Disbursements (expenses, salaries)", <N key="d" k={cash.disbursements} />], ["Deposited to bank", <N key="b" k={cash.deposits} />], ["Expected closing cash (book)", <b key="x"><N k={cash.closing} /></b>]]} />
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-5">
        {!isCash && (
          <Card title="Statement lines" pad={false} className="xl:col-span-3">
            <div className="max-h-[40rem] overflow-auto"><table><thead><tr>{["Date", "Description / ref.", "Amount", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{ws.lines.map((l) => {
                const candidates = ws.summary.unmatchedBook.filter((b) => Math.sign(b.amount) === Math.sign(l.amount));
                return (
                  <tr key={String(l.id)} className={l.status === "unmatched" ? "bg-rose-50/40" : ""}>
                    <td className="td text-xs"><D d={isoOf(l.line_date)} /></td>
                    <td className="td text-xs">{String(l.description ?? "")}<div className="text-slate-500">{String(l.reference ?? "")}</div>
                      {l.account_txn_id ? <div className="text-brand-700">↔ {String(l.txn_description)} ({String(l.method)})</div> : null}
                      {l.pending_payment_id ? <div className="text-amber-700">Evidence for pending payment <Link className="link" href={`/payments/${l.pending_payment_id}`}>{String(l.pending_payment_no)}</Link> — awaiting Director approval</div> : null}
                      {l.note ? <div className="italic text-slate-500">{String(l.note)}</div> : null}</td>
                    <td className={`td num ${l.amount < 0 ? "text-rose-600" : ""}`}><N k={l.amount} /></td>
                    <td className="td"><StatusBadge status={l.status} /></td>
                    <td className="td whitespace-nowrap">{manage && (
                      <div className="flex flex-wrap gap-1">
                        {l.status === "unmatched" && <>
                          <ReasonAction action={manualMatchAction} className="btn-secondary btn-sm" label="Match" title="Match to a book entry" reason={false} hidden={{ lineId: String(l.id) }}
                            description={`Statement: ${formatNaira(l.amount)} — ${l.description}`}
                            extra={<div className="mt-3 space-y-2"><Field label="Book entry" name="accountTxnId"><select id="accountTxnId" name="accountTxnId" required>{candidates.map((b) => <option key={String(b.id)} value={String(b.id)}>{isoOf(b.txn_date)} · {formatNaira(b.amount)} · {String(b.description).slice(0, 50)}</option>)}</select></Field>
                              <Field label="Note (required if amounts differ)" name="note"><input id="note" name="note" /></Field></div>} />
                          <ReasonAction action={categoriseAction} className="btn-secondary btn-sm" label="Record" title="Record bank-only item" reasonLabel="Note" hidden={{ lineId: String(l.id) }}
                            description="For items that appear only on the statement, e.g. bank charges, SMS fees, interest. This posts the item to the book and matches it."
                            extra={<div className="mt-3 grid grid-cols-2 gap-3"><Field label="Type" name="kind"><select id="kind" name="kind" defaultValue={l.amount < 0 ? "bank_charge" : "interest"}>
                              {l.amount < 0 ? <><option value="bank_charge">Bank charge</option><option value="other_expense">Other expense</option></> : <><option value="interest">Interest</option><option value="other_income">Other income</option></>}</select></Field>
                              <Field label="Category" name="categoryName"><input id="categoryName" name="categoryName" defaultValue={l.amount < 0 ? "Bank charges" : "Interest received"} /></Field></div>} />
                          <ReasonAction action={ignoreAction} className="btn-ghost btn-sm" label="Ignore" title="Ignore line" hidden={{ lineId: String(l.id) }} />
                        </>}
                        {l.status === "duplicate" && <ReasonAction action={ignoreAction} className="btn-ghost btn-sm" label="Confirm duplicate" title="Ignore duplicate line" hidden={{ lineId: String(l.id) }} />}
                        {["matched", "ignored"].includes(l.status) && <ReasonAction action={unmatchAction} className="btn-ghost btn-sm" label="Undo" title="Undo match" hidden={{ lineId: String(l.id) }} />}
                      </div>)}</td>
                  </tr>);
              })}</tbody></table>
              {!ws.lines.length && <p className="p-5 text-sm text-slate-500">No statement lines in this range. Import a statement first.</p>}</div>
          </Card>
        )}
        <Card title={isCash ? "Cash book" : "Book entries not yet on the statement"} pad={false} className={isCash ? "xl:col-span-3" : "xl:col-span-2"}>
          <div className="max-h-[40rem] overflow-auto"><table><thead><tr>{["Date", "Description", "Amount"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{(isCash ? ws.book : ws.summary.unmatchedBook).map((b) => <tr key={String(b.id)}><td className="td text-xs"><D d={isoOf(b.txn_date)} /></td><td className="td text-xs">{String(b.description)}<div className="text-slate-500">{String(b.reference ?? "")}</div></td><td className={`td num ${b.amount < 0 ? "text-rose-600" : ""}`}><N k={b.amount} /></td></tr>)}</tbody></table></div>
        </Card>
        {manage && (
          <Card title="Close a period" className="xl:col-span-2">
            <ActionForm action={startRecAction} className="space-y-3"><input type="hidden" name="accountId" value={id} />
              <div className="grid grid-cols-2 gap-3"><Field label="Period start" name="periodStart"><input id="periodStart" type="date" name="periodStart" required defaultValue={sp1(sp, "from")} /></Field>
                <Field label="Period end" name="periodEnd"><input id="periodEnd" type="date" name="periodEnd" required defaultValue={sp1(sp, "to")} /></Field></div>
              <Field label={isCash ? "Cash physically counted (₦)" : "Closing balance on bank statement (₦)"} name="statementBalance" hint={`Book balance at ${to.split("-").reverse().join("/")}: ${formatNaira(book)}${lastBal !== undefined ? ` · last statement balance ${formatNaira(lastBal)}` : ""}`}>
                <input id="statementBalance" name="statementBalance" inputMode="decimal" required defaultValue={lastBal !== undefined ? (lastBal / 100).toFixed(2) : ""} /></Field>
              <Field label="Notes" name="notes"><input id="notes2" name="notes" /></Field>
              <Submit>Start reconciliation</Submit>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
