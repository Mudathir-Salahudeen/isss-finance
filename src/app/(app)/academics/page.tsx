import { requirePage } from "@/server/session";
import { getStructure } from "@/server/services/academics";
import { PageHeader, Card, D, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { sessionAction, termAction, classAction, armAction } from "./actions";

export const metadata = { title: "Classes & sessions" };
export default async function Academics() {
  await requirePage("academics.manage");
  const st = await getStructure();
  const cname = (id: number | null) => st.classes.find((c) => c.id === id)?.name;
  return (
    <>
      <PageHeader title="Academic structure" subtitle="Sessions, terms, classes, arms and the class progression order used for promotion." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Academic sessions & terms">
          <ul className="mb-4 space-y-3 text-sm">
            {st.sessions.map((s) => (
              <li key={s.id} className="rounded border border-slate-200 p-2">
                <div className="flex items-center justify-between"><span className="font-semibold">{s.name}</span>{s.isCurrent && <Badge tone="emerald">Current</Badge>}</div>
                <div className="text-xs text-slate-500"><D d={s.startDate} /> – <D d={s.endDate} /></div>
                <ul className="mt-1 text-xs">{st.terms.filter((t) => t.sessionId === s.id).map((t) => <li key={t.id}>{t.seq}. {t.name} (<D d={t.startDate} /> – <D d={t.endDate} />) {t.isCurrent && <Badge tone="emerald">Current term</Badge>}</li>)}</ul>
              </li>
            ))}
          </ul>
          <details className="mb-3"><summary className="btn-secondary btn-sm cursor-pointer">Add session</summary>
            <ActionForm action={sessionAction} className="mt-3 grid grid-cols-2 gap-3" resetOnSuccess>
              <div className="col-span-2"><label htmlFor="sn" className="mb-1 block">Name</label><input id="sn" name="name" placeholder="2027/2028" required pattern="\d{4}/\d{4}" /></div>
              <div><label htmlFor="ss" className="mb-1 block">Start</label><input id="ss" type="date" name="startDate" /></div>
              <div><label htmlFor="se" className="mb-1 block">End</label><input id="se" type="date" name="endDate" /></div>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="isCurrent" /> Make current session</label>
              <Submit>Save session</Submit>
            </ActionForm>
          </details>
          <details><summary className="btn-secondary btn-sm cursor-pointer">Add or update term</summary>
            <ActionForm action={termAction} className="mt-3 grid grid-cols-2 gap-3" resetOnSuccess>
              <div><label htmlFor="ts" className="mb-1 block">Session</label><select id="ts" name="sessionId">{st.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label htmlFor="tid" className="mb-1 block">Existing term (to edit)</label><select id="tid" name="id"><option value="">New term</option>{st.terms.map((t) => <option key={t.id} value={t.id}>{st.sessions.find((s) => s.id === t.sessionId)?.name} — {t.name}</option>)}</select></div>
              <div><label htmlFor="tn" className="mb-1 block">Term name</label><input id="tn" name="name" placeholder="First Term" required /></div>
              <div><label htmlFor="tq" className="mb-1 block">Order</label><input id="tq" type="number" name="seq" min={1} max={6} defaultValue={1} required /></div>
              <div><label htmlFor="tst" className="mb-1 block">Start</label><input id="tst" type="date" name="startDate" /></div>
              <div><label htmlFor="tend" className="mb-1 block">End</label><input id="tend" type="date" name="endDate" /></div>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="isCurrent" /> Make current term (also sets its session as current)</label>
              <Submit>Save term</Submit>
            </ActionForm>
          </details>
        </Card>
        <Card title="Classes, arms & progression order">
          <table className="mb-4"><thead><tr><th className="th">Order</th><th className="th">Class</th><th className="th">Arms</th><th className="th">Progresses to</th></tr></thead>
            <tbody>{st.classes.map((c) => (
              <tr key={c.id} className={c.active ? "" : "text-slate-400"}><td className="td">{c.levelOrder}</td><td className="td font-medium">{c.name}</td>
                <td className="td">{st.arms.filter((x) => x.classId === c.id).map((x) => x.name).join(", ") || "—"}</td>
                <td className="td">{c.isTerminal ? <Badge tone="indigo">Graduates</Badge> : cname(c.nextClassId) ?? <Badge tone="amber">Not set</Badge>}</td></tr>))}</tbody></table>
          <details className="mb-3"><summary className="btn-secondary btn-sm cursor-pointer">Add or edit class</summary>
            <ActionForm action={classAction} className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label htmlFor="cid" className="mb-1 block">Existing class (to edit)</label><select id="cid" name="id"><option value="">New class</option>{st.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label htmlFor="cn" className="mb-1 block">Name</label><input id="cn" name="name" required placeholder="JSS 1" /></div>
              <div><label htmlFor="co" className="mb-1 block">Order</label><input id="co" type="number" name="levelOrder" required min={1} /></div>
              <div><label htmlFor="cnx" className="mb-1 block">Next class</label><select id="cnx" name="nextClassId"><option value="">— none —</option>{st.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label htmlFor="ca" className="mb-1 block">Status</label><select id="ca" name="active"><option value="1">Active</option><option value="0">Inactive</option></select></div>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="isTerminal" /> Final class (students graduate from it)</label>
              <Submit>Save class</Submit>
            </ActionForm>
          </details>
          <details><summary className="btn-secondary btn-sm cursor-pointer">Add arm / stream</summary>
            <ActionForm action={armAction} className="mt-3 grid grid-cols-2 gap-3" resetOnSuccess>
              <div><label htmlFor="ac" className="mb-1 block">Class</label><select id="ac" name="classId">{st.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label htmlFor="an" className="mb-1 block">Arm name</label><input id="an" name="name" required placeholder="A / Gold" /></div>
              <Submit>Save arm</Submit>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
