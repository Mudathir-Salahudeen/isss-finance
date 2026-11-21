import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/session";
import { getStudent, STUDENT_STATUSES } from "@/server/services/students";
import { chargeBalances, studentStatement, paymentStatusOf } from "@/server/services/ledger";
import { chargeAdjustments } from "@/server/services/fees";
import { listPayments } from "@/server/services/payments";
import { promotionHistory } from "@/server/services/promotion";
import { getStructure } from "@/server/services/academics";
import { PageHeader, Card, DL, N, D, DT, StatusBadge, Tabs, Alert, Field } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { ClassArmSelect } from "@/components/client/ClassArmSelect";
import { StudentFields } from "@/components/StudentFields";
import { SP, sp1 } from "@/components/DataTable";
import { can } from "@/server/actor";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { updateStudentAction, statusAction, placementAction, adjustAction, reverseAdjAction, cancelChargeAction } from "../actions";

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const a = await requirePage("students.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const tab = sp1(sp, "tab") ?? "account";
  let g;
  try { g = await getStudent(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const s = g.student;
  const st = await getStructure();
  const sessionFilter = Number(sp1(sp, "sessionId")) || undefined;
  const ledger = can(a, "ledger.view");
  const charges = ledger ? await chargeBalances({ studentId: id, sessionId: sessionFilter, includeCancelled: true }) : [];
  const adjs = ledger ? await chargeAdjustments(charges.map((c) => c.chargeId)) : [];
  const stmt = ledger ? await studentStatement(id, { sessionId: sessionFilter }) : null;
  const payments = can(a, "payments.view") || can(a, "payments.approve") ? await listPayments(a, { studentId: id }) : [];
  const promos = await promotionHistory({ studentId: id });
  const active = charges.filter((c) => c.chargeStatus === "active");
  const tot = { net: active.reduce((t, c) => t + c.net, 0), paid: active.reduce((t, c) => t + c.paid, 0), pending: active.reduce((t, c) => t + c.pending, 0), outstanding: active.reduce((t, c) => t + c.outstanding, 0) };
  const base = `/students/${id}`;
  const q = (t: string) => `${base}?tab=${t}${sessionFilter ? `&sessionId=${sessionFilter}` : ""}`;
  return (
    <>
      <PageHeader title={`${s.lastName}, ${s.firstName} ${s.middleName ?? ""}`} back={{ href: "/students", label: "Students" }}
        subtitle={<>{s.admissionNo} · {g.current ? `${g.current.className} ${g.current.armName ?? ""} (${g.current.sessionName})` : "No enrolment"} · <StatusBadge status={s.status} /></>}
        actions={<>
          {can(a, "payments.create") && s.status === "active" && <Link className="btn-primary" href={`/payments/new?studentId=${id}`}>Record payment</Link>}
          {ledger && <a className="btn-secondary" href={`/api/statements/${id}${sessionFilter ? `?sessionId=${sessionFilter}` : ""}`} target="_blank" rel="noopener">Statement PDF</a>}
          {ledger && can(a, "reports.export") && <a className="btn-secondary" href={`/api/export/statement?studentId=${id}&format=xlsx${sessionFilter ? `&sessionId=${sessionFilter}` : ""}`}>Statement Excel</a>}
        </>} />
      {ledger && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="card p-3"><div className="text-xs text-slate-500">Fees charged (net)</div><div className="text-lg font-semibold"><N k={tot.net} /></div></div>
          <div className="card p-3"><div className="text-xs text-slate-500">Approved payments</div><div className="text-lg font-semibold text-emerald-700"><N k={tot.paid} /></div></div>
          <div className="card p-3"><div className="text-xs text-slate-500">Outstanding balance</div><div className="text-lg font-semibold text-rose-700"><N k={tot.outstanding} /></div><StatusBadge status={paymentStatusOf(tot.net, tot.paid, tot.pending)} /></div>
          <div className="card p-3"><div className="text-xs text-slate-500">Awaiting approval (not credited)</div><div className="text-lg font-semibold text-amber-700"><N k={tot.pending} /></div></div>
        </div>
      )}
      <form method="get" className="no-print mb-3 flex items-end gap-2"><input type="hidden" name="tab" value={tab} />
        <div className="w-48"><label htmlFor="sf" className="mb-1 block text-xs">Session</label><select id="sf" name="sessionId" defaultValue={sessionFilter ?? ""}><option value="">All sessions</option>{st.sessions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <button className="btn-secondary">Filter</button>
      </form>
      <Tabs current={tab} tabs={[
        ...(ledger ? [{ key: "account", label: "Fee account", href: q("account") }, { key: "statement", label: "Statement", href: q("statement") }] : []),
        { key: "payments", label: "Payments", href: q("payments"), count: payments.length }, { key: "details", label: "Details & history", href: q("details") },
      ]} />

      {tab === "account" && ledger && (
        <Card title="Fee items" pad={false}>
          <div className="overflow-x-auto"><table>
            <thead><tr>{["Fee", "Session / term", "Class (at charge)", "Due", "Charged", "Adjustments", "Approved paid", "Pending", "Balance", ""].map((h) => <th key={h} className={`th ${["Charged", "Adjustments", "Approved paid", "Pending", "Balance"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.chargeId} className={c.chargeStatus === "cancelled" ? "text-slate-400 line-through" : ""}>
                  <td className="td">{c.feeName}<div className="text-xs text-slate-500">{c.categoryName}</div>
                    {adjs.filter((x) => x.chargeId === c.chargeId).map((x) => (
                      <div key={x.id} className={`text-xs ${x.reversedAt ? "text-slate-400 line-through" : "text-indigo-700"}`}>{x.kind} {formatNaira(x.amount)} — {x.reason}
                        {!x.reversedAt && can(a, "fees.adjust") && <span className="ml-1 inline-block no-underline"><ReasonAction action={reverseAdjAction} className="btn-ghost btn-sm" label="Undo" title="Reverse adjustment" hidden={{ adjustmentId: x.id }} /></span>}</div>))}
                  </td>
                  <td className="td">{c.sessionName}<div className="text-xs text-slate-500">{c.termName}</div></td>
                  <td className="td">{c.className} {c.armName}</td>
                  <td className="td"><D d={c.dueDate} /></td>
                  <td className="td num"><N k={c.amount} /></td><td className="td num"><N k={c.adjustments} /></td><td className="td num"><N k={c.paid} /></td>
                  <td className="td num text-amber-700">{c.pending ? <N k={c.pending} /> : "—"}</td><td className="td num font-semibold"><N k={c.outstanding} /></td>
                  <td className="td whitespace-nowrap">
                    {c.chargeStatus === "active" && can(a, "fees.adjust") && (
                      <div className="flex gap-1">
                        <ReasonAction action={adjustAction} className="btn-secondary btn-sm" label="Adjust" title={`Adjust ${c.feeName}`} hidden={{ chargeId: c.chargeId }}
                          description={`Outstanding on this item: ${formatNaira(c.outstanding)}. Waivers/discounts reduce what the student owes; increases add to it.`}
                          extra={<div className="mt-3 grid grid-cols-2 gap-3"><Field label="Type" name="kind"><select id="kind" name="kind"><option value="waiver">Waiver</option><option value="discount">Discount</option><option value="increase">Increase</option></select></Field>
                            <Field label="Amount (₦)" name="amount" required><input id="amount" name="amount" inputMode="decimal" required /></Field></div>} />
                        {c.paid === 0 && c.pending === 0 && <ReasonAction action={cancelChargeAction} className="btn-ghost btn-sm text-rose-700" label="Cancel" title={`Cancel charge: ${c.feeName}`} hidden={{ chargeId: c.chargeId }} description="Cancelling removes this charge from the balance. It stays visible in history." />}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!charges.length && <p className="p-4 text-sm text-slate-500">No fees have been charged to this student{sessionFilter ? " in this session" : ""}.</p>}
        </Card>
      )}

      {tab === "statement" && stmt && (
        <Card title="Statement of account" pad={false} actions={<span className="text-xs text-slate-500">Approved transactions only · closing {formatNaira(stmt.closing)}</span>}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th className="th">Date</th><th className="th">Description</th><th className="th">Receipt / ref.</th><th className="th text-right">Charges</th><th className="th text-right">Payments / credits</th><th className="th text-right">Balance</th></tr></thead>
            <tbody>{stmt.lines.map((l, i) => (
              <tr key={i}><td className="td"><D d={l.date} /></td><td className="td">{l.description}<div className="text-xs text-slate-500">{l.session} {l.term}</div></td><td className="td">{l.reference}</td>
                <td className="td num">{l.debit ? <N k={l.debit} /> : ""}</td><td className="td num">{l.credit ? <N k={l.credit} /> : ""}</td><td className="td num font-medium"><N k={l.balance} /></td></tr>))}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={3}>Totals / closing balance</td><td className="td num"><N k={stmt.totals.debit} /></td><td className="td num"><N k={stmt.totals.credit} /></td><td className="td num"><N k={stmt.closing} /></td></tr></tfoot>
          </table></div>
          {tot.pending > 0 && <div className="p-3"><Alert tone="warn">{formatNaira(tot.pending)} in payments is awaiting Director approval and is not yet on this statement.</Alert></div>}
        </Card>
      )}

      {tab === "payments" && (
        <Card title="Payments" pad={false}>
          <table><thead><tr>{["Payment / receipt", "Date", "Amount", "Fees", "Method", "Status", "Recorded by"].map((h) => <th key={h} className={`th ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}><td className="td"><Link className="link" href={`/payments/${p.id}`}>{p.receiptNo ?? p.paymentNo}</Link></td><td className="td"><D d={p.paymentDate} /></td><td className="td num"><N k={p.amount} /></td>
                <td className="td text-xs">{p.fees}</td><td className="td">{p.channelName}</td><td className="td"><StatusBadge status={p.status} /></td><td className="td text-xs">{p.recordedByName}</td></tr>))}</tbody></table>
          {!payments.length && <p className="p-4 text-sm text-slate-500">No payments recorded.</p>}
        </Card>
      )}

      {tab === "details" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Student details">
              {can(a, "students.edit") ? (
                <ActionForm action={updateStudentAction} className="space-y-4"><input type="hidden" name="id" value={id} />
                  <StudentFields s={s} /><Submit>Save changes</Submit></ActionForm>
              ) : (
                <DL items={[["Admission No.", s.admissionNo], ["Gender", s.gender], ["Date of birth", <D key="d" d={s.dateOfBirth} />], ["Guardian", s.guardianName], ["Phone", s.guardianPhone], ["Email", s.guardianEmail], ["Address", s.guardianAddress]]} />
              )}
            </Card>
            <Card title="Enrolment history (one record per session — never overwritten)" pad={false}>
              <table><thead><tr>{["Session", "Class", "Arm", "How", "Status", "Current"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{g.enrolments.map((e) => (<tr key={e.id}><td className="td">{e.sessionName}</td><td className="td">{e.className}</td><td className="td">{e.armName ?? "—"}</td><td className="td">{e.entryType}</td><td className="td"><StatusBadge status={e.status} /></td><td className="td">{e.isCurrent ? "✓" : ""}</td></tr>))}</tbody></table>
            </Card>
            <Card title="Promotion history" pad={false}>
              <table><thead><tr>{["When", "Action", "From", "To", "By", "Reversed"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{promos.map((p) => (<tr key={String(p.id)}><td className="td"><DT d={p.performed_at as Date} /></td><td className="td"><StatusBadge status={String(p.action)} /></td>
                  <td className="td">{String(p.from_class ?? "")} {String(p.from_arm ?? "")} ({String(p.from_session ?? "")})</td><td className="td">{p.to_class ? `${p.to_class} ${p.to_arm ?? ""} (${p.to_session})` : "—"}</td>
                  <td className="td text-xs">{String(p.performed_by_name)}</td><td className="td text-xs">{p.reversed_at ? `Yes — ${p.reversal_reason}` : ""}</td></tr>))}</tbody></table>
              {!promos.length && <p className="p-4 text-sm text-slate-500">No promotions yet.</p>}
            </Card>
          </div>
          {can(a, "students.edit") && (
            <div className="space-y-4">
              <Card title="Change status">
                <ActionForm action={statusAction} className="space-y-3"><input type="hidden" name="id" value={id} />
                  <Field label="Status" name="status"><select id="status" name="status" defaultValue={s.status}>{STUDENT_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
                  <Field label="Effective date" name="effectiveDate"><input id="effectiveDate" type="date" name="effectiveDate" /></Field>
                  <Field label="Reason" name="reason" hint="Required unless re-activating"><textarea id="reason" name="reason" rows={2} /></Field>
                  <Submit>Update status</Submit>
                  <p className="hint">Withdrawn, transferred and graduated students keep all history and are excluded from future fee assignment.</p>
                </ActionForm>
              </Card>
              {g.current && (
                <Card title={`Correct class/arm (${g.current.sessionName})`}>
                  <ActionForm action={placementAction} className="space-y-3"><input type="hidden" name="id" value={id} />
                    <ClassArmSelect prefix="pl-" classes={st.classes} arms={st.arms} defaultClassId={g.current.classId} defaultArmId={g.current.armId} />
                    <Field label="Reason" name="reason" required><input id="reason2" name="reason" required /></Field>
                    <Submit className="btn-secondary">Correct placement</Submit>
                    <p className="hint">For moving to the next class at year end, use Promotion instead.</p>
                  </ActionForm>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
