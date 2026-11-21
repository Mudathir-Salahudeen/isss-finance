import { requirePage } from "@/server/session";
import { getStaff } from "@/server/services/payroll";
import { PageHeader, Card, N, D, StatusBadge, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { StaffFields } from "@/components/StaffForm";
import { staffAction, salaryAction, payItemAction, loanAction } from "../../actions";
import { can } from "@/server/actor";
import Link from "next/link";
import { todayISO } from "@/lib/dates";

export default async function StaffPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requirePage("payroll.view");
  const id = Number((await params).id);
  const d = await getStaff(a, id);
  const m = can(a, "payroll.manage_staff");
  const cur = d.salaryHistory.find((h) => h.effectiveFrom <= todayISO());
  return (
    <>
      <PageHeader title={d.staff.fullName} back={{ href: "/payroll", label: "Staff" }} subtitle={<>{d.staff.staffNo} · {d.staff.position} · <StatusBadge status={d.staff.status} /> · Basic <N k={cur?.basic} /></>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Staff record">{m ? <ActionForm action={staffAction}><StaffFields s={d.staff} /></ActionForm> : <p className="text-sm">{d.staff.department} · {d.staff.bankName}</p>}</Card>
          <Card title="Salary history (changes are never overwritten)" pad={false}>
            <table><thead><tr>{["Effective from", "Basic", "Reason", "By"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.salaryHistory.map((h) => <tr key={h.id}><td className="td"><D d={h.effectiveFrom} /></td><td className="td num"><N k={h.basic} /></td><td className="td">{h.reason}</td><td className="td text-xs">{h.byName}</td></tr>)}</tbody></table>
          </Card>
          <Card title="Payroll history" pad={false}>
            <table><thead><tr>{["Period", "Gross", "Net", "Paid", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.lines.map((l) => <tr key={String(l.id)}><td className="td"><Link className="link" href={`/payroll/periods/${l.period_id}`}>{String(l.period)}</Link></td><td className="td num"><N k={Number(l.gross)} /></td><td className="td num"><N k={Number(l.net)} /></td><td className="td num"><N k={Number(l.paid_amount)} /></td><td className="td"><StatusBadge status={String(l.period_status)} /></td>
                <td className="td">{["approved", "partially_paid", "paid"].includes(String(l.period_status)) && <a className="link text-xs" href={`/api/payslips/${l.id}`} target="_blank">Payslip</a>}</td></tr>)}</tbody></table>
          </Card>
        </div>
        <div className="space-y-4">
          {m && <Card title="Change salary">
            <ActionForm action={salaryAction} className="space-y-3" resetOnSuccess><input type="hidden" name="staffId" value={id} />
              <Field label="New basic (₦)" name="basic" required><input id="nb" name="basic" inputMode="decimal" required /></Field>
              <Field label="Effective from" name="effectiveFrom" required><input id="ef" type="date" name="effectiveFrom" required /></Field>
              <Field label="Reason" name="reason" required><input id="sr" name="reason" required /></Field><Submit>Record change</Submit></ActionForm></Card>}
          <Card title="Allowances & deductions">
            <ul className="mb-3 space-y-1 text-sm">{d.items.map((i) => <li key={i.id} className={`flex justify-between ${i.active ? "" : "text-slate-400 line-through"}`}><span>{i.kind === "deduction" ? "−" : "+"} {i.name}</span><N k={i.amount} /></li>)}</ul>
            {m && <ActionForm action={payItemAction} className="grid grid-cols-2 gap-2" resetOnSuccess><input type="hidden" name="staffId" value={id} />
              <select aria-label="Kind" name="kind"><option value="allowance">Allowance</option><option value="deduction">Deduction</option></select><input aria-label="Name" name="name" placeholder="Name" required />
              <input aria-label="Amount" name="amount" placeholder="₦ amount" inputMode="decimal" required /><Submit className="btn-secondary">Add</Submit></ActionForm>}
          </Card>
          <Card title="Loans & advances">
            <ul className="mb-3 space-y-1 text-sm">{d.loans.map((l) => <li key={l.id}>{l.kind} <N k={l.principal} /> · balance <N k={l.balance} /> · <N k={l.monthlyDeduction} />/month <StatusBadge status={l.status} /></li>)}</ul>
            {m && <ActionForm action={loanAction} className="grid grid-cols-2 gap-2" resetOnSuccess><input type="hidden" name="staffId" value={id} />
              <select aria-label="Kind" name="kind"><option value="advance">Salary advance</option><option value="loan">Loan</option></select><input aria-label="Principal" name="principal" placeholder="Principal ₦" required />
              <input aria-label="Monthly deduction" name="monthlyDeduction" placeholder="Monthly ₦" required /><input aria-label="Reason" name="reason" placeholder="Reason" /><Submit className="btn-secondary">Add</Submit></ActionForm>}
          </Card>
        </div>
      </div>
    </>
  );
}
