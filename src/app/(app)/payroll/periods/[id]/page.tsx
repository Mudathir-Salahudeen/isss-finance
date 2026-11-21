import { requirePage } from "@/server/session";
import { getPeriod } from "@/server/services/payroll";
import { accessibleAccounts } from "@/server/services/accounts";
import { getSettings } from "@/server/services/admin";
import { PageHeader, Card, N, D, DT, StatusBadge, Alert, Field } from "@/components/ui";
import { ActionForm, Submit, ReasonAction, InlineAction } from "@/components/client/forms";
import * as X from "../../actions";
import { can } from "@/server/actor";
import { todayISO } from "@/lib/dates";
import { formatNaira } from "@/lib/money";

export default async function PeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requirePage("payroll.view");
  const id = Number((await params).id);
  const d = await getPeriod(a, id);
  const p = d.period;
  const editable = ["draft", "rejected"].includes(p.status) && can(a, "payroll.prepare");
  const payable = ["approved", "partially_paid"].includes(p.status) && can(a, "payroll.pay");
  const accs = payable ? await accessibleAccounts(a) : [];
  const tot = d.lines.reduce((t, l) => ({ gross: t.gross + l.gross, net: t.net + l.net, paid: t.paid + l.paidAmount, ded: t.ded + l.deductions + l.loanDeduction }), { gross: 0, net: 0, paid: 0, ded: 0 });
  const selfPrepared = (p.createdBy === a.id || p.submittedBy === a.id) && !(await getSettings()).allowSelfApprovalExpenses;
  return (
    <>
      <PageHeader title={p.name} back={{ href: "/payroll/periods", label: "Payroll periods" }} subtitle={<><StatusBadge status={p.status} /> · pay date <D d={p.payDate} /></>}
        actions={<><a className="btn-secondary" href={`/api/export/payroll_lines?periodId=${id}&format=xlsx`}>Excel</a><a className="btn-secondary" href={`/api/export/payroll_lines?periodId=${id}&format=pdf`} target="_blank">PDF</a></>} />
      {p.status === "rejected" && <div className="mb-4"><Alert tone="error" title="Returned for correction">{p.rejectionReason}</Alert></div>}
      {["approved", "partially_paid", "paid"].includes(p.status) && <div className="mb-4"><Alert tone="info">Approved payroll is locked. Corrections go into a later period (e.g. as arrears or a deduction).</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[["Gross", tot.gross], ["Deductions", tot.ded], ["Net pay", tot.net], ["Paid so far", tot.paid]].map(([l, v]) => <div key={String(l)} className="card p-4"><div className="text-xl font-semibold"><N k={Number(v)} /></div><div className="text-xs uppercase text-slate-400">{l}</div></div>)}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {editable && <ActionForm action={X.submitPayrollAction}><input type="hidden" name="id" value={id} /><Submit>Submit for approval</Submit></ActionForm>}
        {editable && <ReasonAction action={X.cancelPayrollAction} className="btn-secondary" label="Cancel payroll" title="Cancel this payroll" hidden={{ id }} />}
        {p.status === "pending" && can(a, "payroll.approve") && (selfPrepared ? <Alert tone="warn">You prepared this payroll; another approver must approve it.</Alert> : <>
          <ActionForm action={X.approvePayrollAction} confirm={`Approve ${p.name}: net ${formatNaira(tot.net)}?`}><input type="hidden" name="id" value={id} /><Submit className="btn-success">Approve payroll</Submit></ActionForm>
          <ReasonAction action={X.rejectPayrollAction} label="Return for correction" title="Reject payroll" hidden={{ id }} /></>)}
      </div>
      {payable && (
        <Card title="Pay all unpaid salaries" className="mb-4">
          <ActionForm action={X.payAllAction} className="flex flex-wrap items-end gap-3" confirm="Record payment for every unpaid line?"><input type="hidden" name="id" value={id} />
            <Field label="Date" name="paymentDate"><input id="pdate" type="date" name="paymentDate" defaultValue={todayISO()} max={todayISO()} required /></Field>
            <Field label="From account" name="accountId"><select id="pacc" name="accountId">{accs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Batch reference" name="reference"><input id="pref" name="reference" required /></Field><Submit>Record payments</Submit></ActionForm>
        </Card>
      )}
      <Card title="Staff lines" pad={false}>
        <div className="overflow-x-auto"><table>
          <thead><tr>{["Staff", "Basic", "Allow.", "Bonus/arrears", "Gross", "Deductions", "Net", "Paid", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{d.lines.map((l) => {
            const items = d.items.filter((i) => i.lineId === l.id);
            const pays = d.payments.filter((x) => x.line_id === l.id);
            return (
              <tr key={l.id}>
                <td className="td">{l.fullName}<div className="text-xs text-slate-500">{l.staffNo} · {l.bankName} ••{l.bankAccountNumber?.slice(-4)}</div>
                  <ul className="mt-1 text-xs text-slate-500">{items.map((i) => <li key={i.id}>{["deduction", "loan"].includes(i.kind) ? "−" : "+"} {i.name} {formatNaira(i.amount)} {editable && <InlineAction action={X.removeItemAction} className="btn-ghost btn-sm" label="×" hidden={{ itemId: i.id }} />}</li>)}</ul>
                  {pays.map((x) => <div key={x.id} className={`text-xs ${x.status === "reversed" ? "text-slate-400 line-through" : "text-brand-700"}`}>Paid {formatNaira(x.amount)} on {x.payment_date} ({x.account_name}, ref {x.reference}) {x.status === "posted" && can(a, "payroll.pay") && <ReasonAction action={X.reverseSalaryAction} className="btn-ghost btn-sm" label="Reverse" title="Reverse salary payment" hidden={{ id: x.id }} />}</div>)}
                </td>
                <td className="td num"><N k={l.basic} /></td><td className="td num"><N k={l.allowances} /></td><td className="td num"><N k={l.bonus + l.arrears} /></td><td className="td num"><N k={l.gross} /></td>
                <td className="td num"><N k={l.deductions + l.loanDeduction} /></td><td className="td num font-semibold"><N k={l.net} /></td><td className="td num"><N k={l.paidAmount} /></td><td className="td"><StatusBadge status={l.status} /></td>
                <td className="td whitespace-nowrap">
                  {editable && <ReasonAction action={X.lineItemAction} className="btn-secondary btn-sm" label="Adjust" title={`Adjust ${l.fullName}`} reason={false} hidden={{ lineId: l.id }}
                    extra={<div className="mt-3 grid grid-cols-3 gap-2"><select aria-label="Kind" name="kind"><option value="bonus">Bonus</option><option value="arrears">Arrears</option><option value="allowance">Allowance</option><option value="deduction">Deduction</option></select>
                      <input aria-label="Description" name="name" placeholder="Description" required /><input aria-label="Amount" name="amount" placeholder="₦" required /></div>} />}
                  {payable && l.paidAmount < l.net && <ReasonAction action={X.payLineAction} className="btn-secondary btn-sm" label="Pay" title={`Pay ${l.fullName}`} reason={false} hidden={{ lineId: l.id }}
                    description={`Unpaid: ${formatNaira(l.net - l.paidAmount)}`}
                    extra={<div className="mt-3 grid grid-cols-2 gap-2"><input aria-label="Amount" name="amount" placeholder={`₦ (default ${((l.net - l.paidAmount) / 100).toFixed(2)})`} /><input aria-label="Date" type="date" name="paymentDate" defaultValue={todayISO()} required />
                      <select aria-label="Account" name="accountId">{accs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><input aria-label="Reference" name="reference" placeholder="Reference" required /></div>} />}
                  {["approved", "partially_paid", "paid"].includes(p.status) && <a className="btn-ghost btn-sm" href={`/api/payslips/${l.id}`} target="_blank">Payslip</a>}
                </td>
              </tr>);
          })}</tbody>
        </table></div>
      </Card>
      <Card title="History" className="mt-4">
        <ol className="space-y-2 text-sm">{d.history.map((h) => <li key={h.id}><b className="capitalize">{h.action}</b> — {h.actorName}, <DT d={h.at} /> {h.comment && `· ${h.comment}`}</li>)}</ol>
      </Card>
    </>
  );
}
