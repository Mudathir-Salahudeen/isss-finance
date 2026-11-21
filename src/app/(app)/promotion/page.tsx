import { requirePage } from "@/server/session";
import { getStructure } from "@/server/services/academics";
import { previewPromotion, promotionHistory, promotionReport } from "@/server/services/promotion";
import { PageHeader, Card, StatusBadge, DT, Alert } from "@/components/ui";
import { SP, sp1 } from "@/components/DataTable";
import { PromotionGrid } from "@/components/client/PromotionGrid";
import { ReasonAction } from "@/components/client/forms";
import { reversePromotionAction } from "./actions";
import { can } from "@/server/actor";
import Link from "next/link";

export const metadata = { title: "Promotion" };
export default async function Promotion({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("students.promote");
  const sp = await searchParams;
  const st = await getStructure();
  const cur = st.sessions.find((s) => s.isCurrent);
  const from = Number(sp1(sp, "from")) || cur?.id;
  const to = Number(sp1(sp, "to")) || st.sessions.find((s) => cur && s.name > cur.name)?.id;
  const classId = Number(sp1(sp, "classId")) || undefined;
  const armId = Number(sp1(sp, "armId")) || undefined;
  let preview = null, err = null;
  if (from && to && classId) { try { preview = await previewPromotion(a, from, to, classId, armId); } catch (e) { err = (e as Error).message; } }
  const report = from ? await promotionReport(from) : [];
  const hist = (await promotionHistory({ sessionId: from })).slice(0, 100);
  return (
    <>
      <PageHeader title="Promotion & class progression" subtitle="Move students into the next session. Previous enrolments, fees, payments and receipts stay exactly where they were."
        actions={<Link className="btn-secondary" href={`/reports/promotions${from ? `?sessionId=${from}` : ""}`}>Promotion report</Link>} />
      {!st.sessions.some((s) => cur && s.name > cur.name) && <div className="mb-4"><Alert tone="warn">Create the next academic session first (Classes & sessions) so students have a session to progress into.</Alert></div>}
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="w-40"><label htmlFor="pf" className="mb-1 block text-xs">From session</label><select id="pf" name="from" defaultValue={from}>{st.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="w-40"><label htmlFor="pt" className="mb-1 block text-xs">Into session</label><select id="pt" name="to" defaultValue={to}>{st.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="w-40"><label htmlFor="pc" className="mb-1 block text-xs">Class</label><select id="pc" name="classId" defaultValue={classId}><option value="">Choose…</option>{st.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="w-40"><label htmlFor="pa" className="mb-1 block text-xs">Arm (optional)</label><select id="pa" name="armId" defaultValue={armId}><option value="">All arms</option>{st.arms.filter((x) => !classId || x.classId === classId).map((x) => <option key={x.id} value={x.id}>{st.classes.find((c) => c.id === x.classId)?.name} {x.name}</option>)}</select></div>
        <button className="btn-primary">Preview students</button>
      </form>
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {preview && (
        <Card title={`Review: ${preview.cls.name} (${preview.from.name}) → ${preview.next?.name ?? (preview.cls.isTerminal ? "Graduation" : "?")} (${preview.to.name})`} className="mb-4">
          {preview.rows.length ? <PromotionGrid rows={preview.rows} classes={preview.classes} arms={preview.arms} fromSessionId={preview.from.id} toSessionId={preview.to.id} toSessionName={preview.to.name} /> : <p className="text-sm text-slate-500">No students enrolled in this class for {preview.from.name}.</p>}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Progress by class — ${st.sessions.find((s) => s.id === from)?.name ?? ""}`} pad={false}>
          <table><thead><tr>{["Class", "Enrolled", "Promoted", "Repeated", "Graduated", "Transferred", "Withdrawn", "Awaiting"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{report.map((r) => <tr key={r.class_id}><td className="td">{r.class_name}</td>{[r.enrolled, r.promoted, r.repeated, r.graduated, r.transferred, r.withdrawn].map((v, i) => <td key={i} className="td num">{v}</td>)}<td className={`td num ${r.awaiting ? "font-semibold text-amber-700" : ""}`}>{r.awaiting}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Recent progression actions" pad={false}>
          <div className="max-h-96 overflow-y-auto"><table><thead><tr>{["Student", "Action", "From → To", "By / when", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{hist.map((h) => (
              <tr key={String(h.id)} className={h.reversed_at ? "text-slate-400" : ""}><td className="td"><Link className="link" href={`/students/${h.student_id}`}>{String(h.student_name)}</Link></td><td className="td"><StatusBadge status={String(h.action)} />{h.reversed_at ? <div className="text-xs">reversed</div> : null}</td>
                <td className="td text-xs">{String(h.from_class)} → {String(h.to_class ?? "—")}</td><td className="td text-xs">{String(h.performed_by_name)}<br /><DT d={h.performed_at as Date} /></td>
                <td className="td">{!h.reversed_at && can(a, "students.promote_reverse") && <ReasonAction action={reversePromotionAction} className="btn-ghost btn-sm" label="Reverse" title="Reverse this progression" hidden={{ eventId: String(h.id) }} description="The new enrolment is marked reversed (kept for audit) and the previous one becomes current again." />}</td></tr>))}</tbody></table></div>
        </Card>
      </div>
    </>
  );
}
