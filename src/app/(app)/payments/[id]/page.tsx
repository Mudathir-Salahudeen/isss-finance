import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyPage } from "@/server/session";
import { getPayment } from "@/server/services/payments";
import { PageHeader, Card, DL, N, D, DT, StatusBadge, Alert } from "@/components/ui";
import { ActionForm, Submit, ReasonAction, InlineAction } from "@/components/client/forms";
import { approveAction, rejectAction, reverseAction, submitDraftAction, deleteDraftAction, evidenceAction } from "../actions";
import { can } from "@/server/actor";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { todayISO } from "@/lib/dates";

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; done?: string }> }) {
  const a = await requireAnyPage("payments.view", "payments.approve");
  const id = Number((await params).id);
  let d;
  try { d = await getPayment(a, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const p = d.payment;
  const { created: created0, done } = await searchParams;
  const created = created0 && d.selfRecorded;
  const name = `${d.student.lastName}, ${d.student.firstName} ${d.student.middleName ?? ""}`;
  const pdfs = d.evidence.filter((e) => e.mime === "application/pdf");
  const imgs = d.evidence.filter((e) => e.mime.startsWith("image/"));
  return (
    <>
      <PageHeader title={d.receipt ? `Receipt ${d.receipt.receiptNo}` : `Payment ${p.paymentNo}`} back={{ href: p.status === "pending" ? "/payments?status=pending" : "/payments", label: "Payments" }}
        subtitle={<><StatusBadge status={p.status} /> · {formatNaira(p.amount)} from {name}</>}
        actions={<>
          {d.receipt && can(a, "receipts.print") && <a className="btn-primary" href={`/api/receipts/${id}`} target="_blank" rel="noopener">{d.receipt.printCount ? "Reprint receipt" : "Print receipt"} (PDF)</a>}
          <Link className="btn-secondary" href={`/students/${p.studentId}`}>Student account</Link>
        </>} />
      {done === "approved" && p.status === "approved" && <div className="mb-4"><Alert tone="success" title={`Approved — receipt ${d.receipt?.receiptNo} issued`}>The payment is now posted to the student ledger, collections and {d.account.name}. Finance has been notified.</Alert></div>}
      {done === "rejected" && p.status === "rejected" && <div className="mb-4"><Alert tone="success">Rejection recorded and Finance notified.</Alert></div>}
      {created && p.status === "pending" && <div className="mb-4"><Alert tone="success" title="Submitted for Director approval">The student&apos;s balance will update and a receipt will be issued only after approval.</Alert></div>}
      {created && p.status === "draft" && <div className="mb-4"><Alert tone="info">Saved as draft. Submit it when ready.</Alert></div>}
      {p.status === "pending" && <div className="mb-4"><Alert tone="warn" title="Pending Director approval">Not credited to the student&apos;s balance, not counted in collections, and no official receipt is available yet.</Alert></div>}
      {p.status === "rejected" && <div className="mb-4"><Alert tone="error" title="Rejected">{p.rejectionReason}</Alert></div>}
      {p.status === "reversed" && <div className="mb-4"><Alert tone="error" title="Reversed">{p.reversalReason} — by {d.reversedByName} on <DT d={p.reversedAt} />. The original record is kept; a reversing entry was posted and the receipt is void.</Alert></div>}
      {d.duplicates.length > 0 && (
        <div className="mb-4"><Alert tone="warn" title="Possible duplicate">
          Same reference or same student, amount and date as: {d.duplicates.map((x, i) => <span key={x.id}>{i ? ", " : ""}<Link className="link" href={`/payments/${x.id}`}>{x.paymentNo}</Link> ({x.status})</span>)}.
          {d.dupAckName && <> Recorder confirmed it is not a duplicate ({d.dupAckName}).</>}
        </Alert></div>
      )}
      {d.bankEvidence.length > 0 && <div className="mb-4"><Alert tone="info" title="Matching bank credit found">
        {d.bankEvidence.map((b) => <div key={b.m.id}>Statement line <D d={b.l.lineDate} /> · {formatNaira(b.l.amount)} · {b.l.description} {b.l.reference}</div>)}
        <div className="text-xs">This is evidence for your review only — reconciliation never approves a payment.</div></Alert></div>}

      {d.canApprove && (
        <Card title="Director decision" className="mb-4 border-amber-200">
          {d.selfRecorded ? <Alert tone="warn">You recorded this payment. School policy may require a different approver.</Alert> : null}
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <ActionForm action={approveAction} className="flex flex-1 flex-wrap items-end gap-3" confirm={`Approve ${formatNaira(p.amount)} for ${name}? This posts to the ledger and issues a receipt.`}>
              <input type="hidden" name="id" value={id} />
              <div className="min-w-64 flex-1"><label htmlFor="comment" className="mb-1 block">Comment (optional)</label><input id="comment" name="comment" placeholder="e.g. Confirmed on GTBank statement" /></div>
              {d.duplicates.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acknowledgeDuplicate" required /> I reviewed the possible duplicate</label>}
              <Submit className="btn-success">Approve payment</Submit>
            </ActionForm>
            <ReasonAction action={rejectAction} label="Reject" title="Reject payment" hidden={{ id }} reasonLabel="Reason for rejection (shared with Finance)" description="The student's ledger will not change." />
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Payment details">
            <DL cols={3} items={[
              ["Student", <Link key="s" className="link" href={`/students/${p.studentId}`}>{name}</Link>], ["Admission No.", d.student.admissionNo], ["Class", `${d.enrolment?.class_name ?? "—"} ${d.enrolment?.arm_name ?? ""}`],
              ["Session / term", `${d.session.name} ${d.term?.name ?? ""}`], ["Amount", <N key="a" k={p.amount} />], ["Payment date", <D key="d" d={p.paymentDate} />],
              ["Channel", d.channel.name], ["Receiving account", d.account.name], ["Reference", p.reference || "—"],
              ["Payer", `${p.payerName || "—"} ${p.payerContact || ""}`], ["Recorded by", <span key="r">{d.recordedByName}<br /><span className="text-xs text-slate-500"><DT d={p.recordedAt} /></span></span>],
              ["Decided by", d.decidedByName ? <span key="x">{d.decidedByName}<br /><span className="text-xs text-slate-500"><DT d={p.decidedAt} /></span></span> : "—"],
              ["Notes", p.notes || "—"], ["Decision comment", p.decisionComment || "—"], ["Payment No.", p.paymentNo],
            ]} />
          </Card>
          <Card title="Fee allocation" pad={false}>
            <table><thead><tr><th className="th">Fee item</th><th className="th">Session / term</th><th className="th text-right">Allocated</th><th className="th text-right">Item balance now</th></tr></thead>
              <tbody>{d.allocations.map((x) => <tr key={x.id}><td className="td">{x.feeName}</td><td className="td">{x.sessionName} {x.termName}</td><td className="td num"><N k={x.amount} /></td><td className="td num"><N k={d.balances.find((b) => b.chargeId === x.chargeId)?.outstanding} /></td></tr>)}</tbody>
              <tfoot><tr className="font-semibold"><td className="td" colSpan={2}>Total</td><td className="td num"><N k={p.amount} /></td><td /></tr></tfoot></table>
          </Card>
          <Card title={`Evidence (${d.evidence.length})`}>
            {!d.evidence.length && <p className="text-sm text-slate-500">No evidence uploaded.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {imgs.map((e) => <a key={e.id} href={`/api/attachments/${e.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-xl border border-slate-100">
                <img src={`/api/attachments/${e.id}`} alt={`Evidence ${e.fileName}`} className="max-h-72 w-full object-contain bg-slate-50" /><div className="px-2 py-1 text-xs">{e.fileName}</div></a>)}
              {pdfs.map((e) => <a key={e.id} className="link block rounded-xl border border-slate-100 p-3 text-sm" href={`/api/attachments/${e.id}`} target="_blank" rel="noopener">📄 {e.fileName}</a>)}
            </div>
            {["draft", "pending"].includes(p.status) && can(a, "payments.create") && (
              <ActionForm action={evidenceAction} className="mt-3 flex items-end gap-2" resetOnSuccess><input type="hidden" name="id" value={id} />
                <div className="flex-1"><label htmlFor="ev" className="mb-1 block text-xs">Add evidence</label><input id="ev" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></div><Submit className="btn-secondary">Upload</Submit></ActionForm>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {p.status === "draft" && can(a, "payments.create") && (
            <Card title="Draft">
              <ActionForm action={submitDraftAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acknowledgeDuplicate" /> Not a duplicate (if warned)</label>
                <Submit>Submit for approval</Submit></ActionForm>
              <div className="mt-3"><InlineAction action={deleteDraftAction} label="Delete draft" className="btn-ghost btn-sm text-rose-700" hidden={{ id }} confirm="Delete this draft?" /></div>
            </Card>
          )}
          {p.status === "approved" && can(a, "payments.reverse") && (
            <Card title="Correction">
              <p className="mb-3 text-sm text-slate-600">Approved payments cannot be edited. Reverse it (the original stays on record) and record a corrected payment if needed.</p>
              <ReasonAction action={reverseAction} label="Reverse payment" title="Reverse approved payment" hidden={{ id }} description={`Reverses ${formatNaira(p.amount)}: student balance increases again, a reversing entry is posted to ${d.account.name}, and receipt ${d.receipt?.receiptNo} becomes void.`}
                extra={<div className="mt-3"><label htmlFor="rd" className="mb-1 block">Reversal date</label><input id="rd" type="date" name="reversalDate" defaultValue={todayISO()} max={todayISO()} /></div>} />
            </Card>
          )}
          <Card title="Approval history">
            <ol className="space-y-3 text-sm">{d.history.map((h) => (
              <li key={h.id} className="border-l-2 border-brand-100 pl-3"><div className="font-medium capitalize">{h.action.replace(/_/g, " ")}</div><div className="text-xs text-slate-500">{h.actorName} · <DT d={h.at} /></div>{h.comment && <div className="text-xs">{h.comment}</div>}</li>))}</ol>
          </Card>
          {d.receipt && (
            <Card title="Receipt prints">
              <p className="text-sm">Printed {d.receipt.printCount} time(s){d.receipt.voided && " · VOID"}</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">{d.prints.map((x) => <li key={x.id}>{x.kind} by {x.byName} · <DT d={x.printedAt} /></li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
