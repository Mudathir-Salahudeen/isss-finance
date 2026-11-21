import { notFound } from "next/navigation";
import { requireAnyPage } from "@/server/session";
import { getExpense, listExpenseCategories, listVendors } from "@/server/services/expenses";
import { accessibleAccounts } from "@/server/services/accounts";
import { PageHeader, Card, DL, N, D, DT, StatusBadge, Alert, Field, Badge } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { ExpenseFields } from "@/components/ExpenseForm";
import * as X from "../actions";
import { can } from "@/server/actor";
import { NotFoundError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import { formatNaira } from "@/lib/money";

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const done = (await searchParams).done;
  const a = await requireAnyPage("expenses.view", "expenses.create", "expenses.approve");
  const id = Number((await params).id);
  let d;
  try { d = await getExpense(a, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const e = d.expense, r = d.row;
  const accs = await accessibleAccounts(a);
  const canDecide = can(a, "expenses.approve") && e.status === "pending";
  const blockedSelf = canDecide && d.selfCreated && !d.allowSelf;
  return (
    <>
      <PageHeader title={`${e.expenseNo} — ${e.title}`} back={{ href: "/expenses", label: "Expenses" }} subtitle={<><StatusBadge status={e.status} /> · {formatNaira(e.amount)} · {r.categoryName}</>} />
      {done && <div className="mb-4"><Alert tone="success">Expense {done}.</Alert></div>}
      {e.status === "approved" && <div className="mb-4"><Alert tone="warn" title="Approved but unpaid">This is a liability. It becomes a cash outflow only when the payment is recorded.</Alert></div>}
      {e.status === "rejected" && <div className="mb-4"><Alert tone="error" title="Rejected">{e.rejectionReason}</Alert></div>}
      {["cancelled", "reversed"].includes(e.status) && <div className="mb-4"><Alert tone="error" title={e.status === "reversed" ? "Reversed" : "Cancelled"}>{e.cancelReason}</Alert></div>}
      {canDecide && (
        <Card title="Approval" className="mb-4">
          {blockedSelf ? <Alert tone="warn">You entered this expense. School policy requires a second approver for your own entries, so another approver must decide.</Alert> : (
            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={X.approveExpenseAction} className="flex flex-1 items-end gap-3"><input type="hidden" name="id" value={id} />
                <div className="flex-1"><label htmlFor="c" className="mb-1 block">Comment</label><input id="c" name="comment" /></div><Submit className="btn-success">Approve</Submit></ActionForm>
              <ReasonAction action={X.rejectExpenseAction} label="Reject" title="Reject expense" hidden={{ id }} />
            </div>)}
          {d.selfCreated && d.allowSelf && <p className="mt-2 text-xs text-slate-500">Self-approval is allowed by policy and will be recorded as such.</p>}
        </Card>
      )}
      {e.status === "approved" && can(a, "expenses.pay") && (
        <Card title="Record payment" className="mb-4">
          <ActionForm action={X.payExpenseAction} className="grid gap-3 sm:grid-cols-4"><input type="hidden" name="id" value={id} />
            <Field label="Paid on" name="paidDate"><input id="paidDate" type="date" name="paidDate" defaultValue={todayISO()} max={todayISO()} required /></Field>
            <Field label="Paid from account" name="accountId"><select id="accountId" name="accountId" defaultValue={e.accountId ?? undefined} required>{accs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Transaction reference" name="reference" required><input id="reference" name="reference" required /></Field>
            <Field label="Proof of payment" name="evidence"><input id="evidence" type="file" name="evidence" accept="image/jpeg,image/png,image/webp,application/pdf" /></Field>
            <div className="sm:col-span-4"><Submit>Mark as paid</Submit></div>
          </ActionForm>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            {e.status === "draft" && d.selfCreated ? (
              <ActionForm action={X.updateExpenseAction}><ExpenseFields e={e} cats={await listExpenseCategories()} vendors={await listVendors()} accounts={accs} today={todayISO()} edit /></ActionForm>
            ) : (
              <DL cols={3} items={[["Amount", <N key="a" k={e.amount} />], ["Date incurred", <D key="d" d={e.dateIncurred} />], ["Category", `${r.categoryName}${e.subcategory ? " / " + e.subcategory : ""}`],
                ["Payee / vendor", r.payee], ["Department", e.department || "—"], ["Payment method", e.paymentMethod || "—"],
                ["Entered by", <span key="c">{r.createdByName} {r.createdByDirector && <Badge tone="indigo">Director</Badge>}<br /><span className="text-xs text-slate-500"><DT d={e.createdAt} /></span></span>],
                ["Approved by", r.approvedByName ? <span key="ap">{r.approvedByName}<br /><span className="text-xs text-slate-500"><DT d={e.approvedAt} /></span></span> : "—"],
                ["Paid", e.paidDate ? <span key="p"><D d={e.paidDate} /> · {r.accountName} · ref {e.paidReference}</span> : "—"],
                ["Recurring", e.recurring ? e.recurrence : "No"], ["Description", e.description || "—"]]} />
            )}
          </Card>
          <Card title={`Evidence (${d.evidence.length})`}>
            {d.evidence.map((x) => <a key={x.id} className="link mr-3 text-sm" href={`/api/attachments/${x.id}`} target="_blank" rel="noopener">📎 {x.fileName}</a>)}
            {!d.evidence.length && <p className="text-sm text-slate-500">No invoice or receipt attached.</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Actions">
            <div className="flex flex-wrap gap-2">
              {e.status === "draft" && d.selfCreated && <ActionForm action={X.submitExpenseAction}><input type="hidden" name="id" value={id} /><Submit>Submit for approval</Submit></ActionForm>}
              {["draft", "pending", "approved"].includes(e.status) && (can(a, "expenses.cancel") || (d.selfCreated && e.status !== "approved")) && <ReasonAction action={X.cancelExpenseAction} label="Cancel" title="Cancel expense" hidden={{ id }} className="btn-secondary" />}
              {e.status === "paid" && can(a, "expenses.cancel") && <ReasonAction action={X.reverseExpenseAction} label="Reverse payment" title="Reverse paid expense" hidden={{ id }} description="Posts a reversing entry to the account. The original stays on record." />}
              {e.recurring && can(a, "expenses.create") && <ReasonAction action={X.duplicateExpenseAction} className="btn-secondary" label="Create next occurrence" title="Copy as new draft" reason={false} hidden={{ id }}
                extra={<div className="mt-3"><label htmlFor="ndi" className="mb-1 block">Date incurred</label><input id="ndi" type="date" name="dateIncurred" defaultValue={todayISO()} required /></div>} />}
            </div>
          </Card>
          <Card title="History">
            <ol className="space-y-3 text-sm">{d.history.map((h) => <li key={h.id} className="border-l-2 border-brand-100 pl-3"><div className="font-medium capitalize">{h.action.replace(/_/g, " ")}</div><div className="text-xs text-slate-500">{h.actorName} · <DT d={h.at} /></div>{h.comment && <div className="text-xs">{h.comment}</div>}</li>)}</ol>
          </Card>
        </div>
      </div>
    </>
  );
}
