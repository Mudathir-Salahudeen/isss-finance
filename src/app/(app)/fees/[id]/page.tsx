import Link from "next/link";
import { requirePage } from "@/server/session";
import { getFee, listFeeCategories, previewAssignment, AssignScope } from "@/server/services/fees";
import { getStructure } from "@/server/services/academics";
import { feeCollectionReport } from "@/server/services/analytics";
import { chargeBalances } from "@/server/services/ledger";
import { PageHeader, Card, DL, N, D, DT, StatusBadge, Alert, Field, Pct } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { FeeFields } from "@/components/FeeForm";
import { DataTable, SP, sp1 } from "@/components/DataTable";
import { updateFeeAction, feeStatusAction, assignAction } from "../actions";
import { can } from "@/server/actor";
import { db } from "@/db";
import { students } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { formatNaira } from "@/lib/money";

export default async function FeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const a = await requirePage("fees.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const { fee, classAmounts, assignments } = await getFee(id);
  const st = await getStructure();
  const cats = await listFeeCategories();
  const coll = (await feeCollectionReport(a, { feeId: id })).list[0];
  const charges = await chargeBalances({ feeId: id, includeCancelled: true });
  const locked = charges.length > 0;
  // Assignment preview (from GET params so it can be reviewed before confirming)
  const mode = sp1(sp, "mode") as AssignScope["mode"] | undefined;
  let scope: AssignScope | null = null, preview = null, previewErr = null;
  if (mode && can(a, "fees.assign")) {
    try {
      if (mode === "students") {
        const adms = (sp1(sp, "admissionNos") ?? "").split(/[\s,;]+/).filter(Boolean);
        const rows = adms.length ? await db.select({ id: students.id, a: students.admissionNo }).from(students).where(inArray(students.admissionNo, adms)) : [];
        const missing = adms.filter((x) => !rows.some((r) => r.a === x));
        if (missing.length) throw new Error(`Unknown admission number(s): ${missing.join(", ")}`);
        scope = { mode, studentIds: rows.map((r) => r.id) };
      } else if (mode === "classes") {
        const all = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v : v ? [v] : []).map(Number).filter(Boolean); };
        scope = { mode, classIds: all("classIds"), armIds: all("armIds") };
      } else scope = { mode: "all" };
      preview = await previewAssignment(a, id, scope);
    } catch (e) { previewErr = (e as Error).message; }
  }
  const assigned = sp1(sp, "assigned");
  return (
    <>
      <PageHeader title={fee.name} back={{ href: "/fees", label: "Fees" }}
        subtitle={<>{cats.find((c) => c.id === fee.categoryId)?.name} · {st.sessions.find((s) => s.id === fee.sessionId)?.name} {st.terms.find((t) => t.id === fee.termId)?.name ?? "(whole session)"} · <StatusBadge status={fee.status} /></>}
        actions={<>
          <Link className="btn-secondary" href={`/debtors?feeId=${id}`}>Debtors for this fee</Link>
          {can(a, "fees.manage") && fee.status !== "cancelled" && !fee.isSystem && <>
            {fee.status !== "active" && <ReasonAction action={feeStatusAction} className="btn-success" label="Activate" title="Activate fee" reason={false} hidden={{ id, status: "active" }} description="Active fees can be assigned to students." />}
            {fee.status === "active" && <ReasonAction action={feeStatusAction} className="btn-secondary" label="Deactivate" title="Deactivate fee" reason={false} hidden={{ id, status: "inactive" }} description="Stops further assignment. Existing charges are unaffected." />}
            <ReasonAction action={feeStatusAction} label="Cancel fee" title="Cancel fee" hidden={{ id, status: "cancelled" }}
              description="The fee and its history are kept. No further assignment is possible."
              extra={<label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="cancelUnpaid" /> Also cancel charges that have no payments recorded</label>} />
          </>}
        </>} />
      {assigned !== undefined && <div className="mb-4"><Alert tone="success">Assignment complete: {assigned} student(s) charged, {sp1(sp, "skipped")} skipped (already charged or not eligible).</Alert></div>}
      {fee.cancelledReason && <div className="mb-4"><Alert tone="warn">Cancelled: {fee.cancelledReason}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        {[["Students charged", coll?.students ?? 0], ["Expected", <N key="e" k={coll?.expected ?? 0} />], ["Approved paid", <N key="p" k={coll?.paid ?? 0} />], ["Outstanding", <N key="o" k={coll?.outstanding ?? 0} />], ["Collection rate", <Pct key="r" tenths={coll?.rateTenths ?? 0} />]].map(([k, v]) => (
          <div key={String(k)} className="card p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {can(a, "fees.assign") && fee.status === "active" && !fee.isSystem && (
          <Card title="Assign to students">
            <form method="get" className="space-y-3">
              <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="sr-only">Who</legend>
                {[["all", "All active students in the session"], ["classes", "Selected classes / arms"], ["students", "Specific students"]].map(([v, l]) => <label key={v} className="flex items-center gap-1.5"><input type="radio" name="mode" value={v} defaultChecked={(mode ?? "classes") === v} /> {l}</label>)}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><div className="mb-1 text-xs font-medium">Classes</div><div className="max-h-40 overflow-y-auto rounded border border-slate-200 p-2 text-sm">{st.classes.map((c) => <label key={c.id} className="flex items-center gap-2"><input type="checkbox" name="classIds" value={c.id} defaultChecked={scope?.classIds?.includes(c.id)} /> {c.name}</label>)}</div></div>
                <div><div className="mb-1 text-xs font-medium">…or specific arms</div><div className="max-h-40 overflow-y-auto rounded border border-slate-200 p-2 text-sm">{st.arms.map((x) => <label key={x.id} className="flex items-center gap-2"><input type="checkbox" name="armIds" value={x.id} defaultChecked={scope?.armIds?.includes(x.id)} /> {st.classes.find((c) => c.id === x.classId)?.name} {x.name}</label>)}</div></div>
              </div>
              <Field label="Admission numbers (for specific students)" name="admissionNos" hint="Separate with commas or new lines"><textarea id="admissionNos" name="admissionNos" rows={2} defaultValue={sp1(sp, "admissionNos")} /></Field>
              <button className="btn-secondary">Preview assignment</button>
            </form>
            {previewErr && <div className="mt-3"><Alert tone="error">{previewErr}</Alert></div>}
            {preview && scope && (
              <div className="mt-4 rounded border border-brand-100 bg-brand-50 p-3">
                <div className="text-sm"><b>{preview.studentCount}</b> student(s) will be charged a total of <b>{formatNaira(preview.totalAmount)}</b>. {preview.skipped.length} skipped.</div>
                {preview.skipped.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer">Show skipped</summary><ul>{preview.skipped.slice(0, 100).map((s) => <li key={s.studentId}>{s.admissionNo} {s.name} — {s.reason}</li>)}</ul></details>}
                <details className="mt-1 text-xs"><summary className="cursor-pointer">Show students to be charged</summary><ul className="max-h-40 overflow-y-auto">{preview.students.map((s) => <li key={s.studentId}>{s.admissionNo} {s.name} — {formatNaira(s.amount)}</li>)}</ul></details>
                {preview.studentCount > 0 && <ActionForm action={assignAction} className="mt-3" confirm={`Charge ${preview.studentCount} student(s) ${formatNaira(preview.totalAmount)} in total?`}>
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="scope" value={JSON.stringify(scope)} /><Submit>Confirm assignment</Submit></ActionForm>}
              </div>
            )}
          </Card>
        )}
        <Card title="Fee details">
          {can(a, "fees.manage") && fee.status !== "cancelled" && !fee.isSystem ? (
            <ActionForm action={updateFeeAction}><FeeFields fee={fee} cats={cats} sessions={st.sessions} terms={st.terms} classes={st.classes} classAmounts={classAmounts} locked={locked} /></ActionForm>
          ) : <DL items={[["Amount", <N key="a" k={fee.amount} />], ["Due", <D key="d" d={fee.dueDate} />], ["Mandatory", fee.mandatory ? "Yes" : "No"], ["Part payment", fee.allowPartial ? "Allowed" : "Not allowed"]]} />}
        </Card>
      </div>
      <Card title="Assignment history" className="mt-4" pad={false}>
        <table><thead><tr>{["When", "Scope", "Students", "Skipped", "Total"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{assignments.map((x) => <tr key={x.id}><td className="td"><DT d={x.createdAt} /></td><td className="td text-xs">{x.scope.mode}</td><td className="td num">{x.studentCount}</td><td className="td num">{x.skippedCount}</td><td className="td num"><N k={x.totalAmount} /></td></tr>)}</tbody></table>
      </Card>
      <div className="mt-4">
        <DataTable title="Charges" path={`/fees/${id}`} sp={sp} rows={charges as unknown as Record<string, unknown>[]} rowHref={(r) => `/students/${r.studentId}`}
          columns={[{ key: "admissionNo", label: "Adm. No." }, { key: "studentName", label: "Student" }, { key: "className", label: "Class", render: (r) => `${r.className ?? ""} ${r.armName ?? ""}` },
            { key: "net", label: "Charged (net)", type: "money" }, { key: "paid", label: "Approved paid", type: "money" }, { key: "pending", label: "Pending", type: "money" }, { key: "outstanding", label: "Balance", type: "money" }, { key: "chargeStatus", label: "Status", type: "status" }]} />
      </div>
    </>
  );
}
