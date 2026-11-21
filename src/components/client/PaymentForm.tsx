"use client";
import { useEffect, useMemo, useState } from "react";
import { searchStudents, studentCharges, createPaymentAction } from "@/app/(app)/payments/actions";
import { ActionForm, Submit, Idempotency, FieldError } from "./forms";

type Student = { id: number; label: string; admissionNo: string; className: string; status: string };
type Charge = Awaited<ReturnType<typeof studentCharges>>[number];
const fmt = (k: number) => `₦${(k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toKobo = (s: string) => { const m = s.replace(/[₦,\s]/g, "").match(/^(\d+)(?:\.(\d{0,2}))?$/); return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : NaN; };
const toStr = (k: number) => (k / 100).toFixed(2);

export function PaymentForm({ channels, accounts, sessions, terms, initialStudent, today }: {
  channels: { id: number; name: string; requiresReference: boolean; requiresEvidence: boolean }[]; accounts: { id: number; name: string; type: string }[];
  sessions: { id: number; name: string; isCurrent: boolean }[]; terms: { id: number; sessionId: number; name: string; isCurrent: boolean }[]; initialStudent?: Student | null; today: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Student[]>([]);
  const [student, setStudent] = useState<Student | null>(initialStudent ?? null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [amount, setAmount] = useState("");
  const [channelId, setChannelId] = useState<number>(channels[0]?.id);
  const ch = channels.find((c) => c.id === channelId);
  useEffect(() => { const t = setTimeout(async () => setResults(q.length >= 2 ? await searchStudents(q) : []), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (student) studentCharges(student.id).then((c) => { setCharges(c); setAlloc({}); }); }, [student]);
  const allocTotal = useMemo(() => Object.values(alloc).reduce((t, v) => t + (toKobo(v) || 0), 0), [alloc]);
  const amt = toKobo(amount);
  const cur = sessions.find((s) => s.isCurrent);
  const sessionId = charges[0]?.sessionId ?? cur?.id;
  const autoAllocate = () => {
    let left = amt; const next: Record<number, string> = {};
    for (const c of [...charges].sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))) {
      const avail = c.outstanding - c.pending;
      if (left <= 0 || avail <= 0) continue;
      if (!c.allowPartial && left < avail) continue; // full-payment-only items are skipped unless fully covered
      const take = Math.min(avail, left); next[c.chargeId] = toStr(take); left -= take;
    }
    setAlloc(next);
  };
  if (!student) return (
    <div className="card p-4">
      <label htmlFor="sq" className="mb-1 block">Find student</label>
      <input id="sq" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type name or admission number…" />
      <ul className="mt-2 divide-y divide-slate-100">{results.map((s) => (
        <li key={s.id}><button type="button" className="w-full px-2 py-2 text-left hover:bg-slate-50" onClick={() => setStudent(s)}><span className="font-medium">{s.label}</span> <span className="text-sm text-slate-500">{s.admissionNo} · {s.className} · {s.status}</span></button></li>))}</ul>
      {q.length >= 2 && !results.length && <p className="mt-2 text-sm text-slate-500">No match.</p>}
    </div>
  );
  return (
    <ActionForm action={createPaymentAction} className="space-y-4">
      <Idempotency />
      <input type="hidden" name="studentId" value={student.id} />
      <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
        <div><div className="font-semibold">{student.label}</div><div className="text-sm text-slate-500">{student.admissionNo} · {student.className}</div></div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { setStudent(null); setCharges([]); }}>Change student</button>
      </div>
      <div className="card grid gap-4 p-4 sm:grid-cols-3">
        <div><label htmlFor="amount" className="mb-1 block">Amount received (₦) <span className="text-rose-600">*</span></label><input id="amount" name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /><FieldError name="amount" /></div>
        <div><label htmlFor="paymentDate" className="mb-1 block">Payment date <span className="text-rose-600">*</span></label><input id="paymentDate" name="paymentDate" type="date" max={today} defaultValue={today} required /></div>
        <div><label htmlFor="channelId" className="mb-1 block">Payment channel <span className="text-rose-600">*</span></label><select id="channelId" name="channelId" value={channelId} onChange={(e) => setChannelId(Number(e.target.value))}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label htmlFor="accountId" className="mb-1 block">Receiving account <span className="text-rose-600">*</span></label><select id="accountId" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
        <div><label htmlFor="reference" className="mb-1 block">Transaction / teller ref.{ch?.requiresReference && <span className="text-rose-600"> *</span>}</label><input id="reference" name="reference" required={ch?.requiresReference} /><FieldError name="reference" /></div>
        <div><label htmlFor="payerName" className="mb-1 block">Payer name</label><input id="payerName" name="payerName" /></div>
        <div><label htmlFor="payerContact" className="mb-1 block">Payer phone/email</label><input id="payerContact" name="payerContact" /></div>
        <div><label htmlFor="sessionId" className="mb-1 block">Session</label><select id="sessionId" name="sessionId" defaultValue={sessionId}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label htmlFor="termId" className="mb-1 block">Term</label><select id="termId" name="termId" defaultValue={terms.find((t) => t.isCurrent)?.id}><option value="">—</option>{terms.map((t) => <option key={t.id} value={t.id}>{sessions.find((s) => s.id === t.sessionId)?.name} {t.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label htmlFor="evidence" className="mb-1 block">Evidence (teller / transfer slip — image or PDF){ch?.requiresEvidence && <span className="text-rose-600"> *</span>}</label><input id="evidence" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><FieldError name="evidence" /></div>
        <div><label htmlFor="notes" className="mb-1 block">Notes</label><input id="notes" name="notes" /></div>
      </div>
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Allocate to fee items</h2><button type="button" className="btn-secondary btn-sm" onClick={autoAllocate} disabled={!(amt > 0)}>Auto-allocate (oldest due first)</button></div>
        {!charges.length ? <p className="text-sm text-slate-500">This student has no outstanding fee items.</p> : (
          <table><thead><tr><th className="th">Fee item</th><th className="th">Due</th><th className="th text-right">Outstanding</th><th className="th text-right">Awaiting approval</th><th className="th text-right">Allocate (₦)</th></tr></thead>
            <tbody>{charges.map((c) => (
              <tr key={c.chargeId}><td className="td">{c.feeName}<div className="text-xs text-slate-500">{c.sessionName} {c.termName} {!c.allowPartial && "· full payment only"}</div></td><td className="td text-xs">{c.dueDate?.split("-").reverse().join("/") ?? "—"}</td>
                <td className="td num">{fmt(c.outstanding)}</td><td className="td num text-amber-700">{c.pending ? fmt(c.pending) : "—"}</td>
                <td className="td w-40"><input aria-label={`Allocate to ${c.feeName}`} name={`alloc_${c.chargeId}`} inputMode="decimal" value={alloc[c.chargeId] ?? ""} onChange={(e) => setAlloc({ ...alloc, [c.chargeId]: e.target.value })} className="text-right" /></td></tr>))}</tbody>
            <tfoot><tr className="font-semibold"><td className="td" colSpan={4}>Allocated</td><td className={`td num ${amt > 0 && allocTotal !== amt ? "text-rose-700" : "text-emerald-700"}`}>{fmt(allocTotal)}{amt > 0 && allocTotal !== amt && <div className="text-xs font-normal">must equal {fmt(amt)}</div>}</td></tr></tfoot>
          </table>
        )}
        <FieldError name="allocations" />
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acknowledgeDuplicate" /> I have checked this is not a duplicate (only needed if warned)</label>
        <div className="ml-auto flex gap-2">
          <Submit className="btn-secondary" name="intent" value="draft">Save as draft</Submit>
          <Submit name="intent" value="submit" disabled={!(amt > 0) || allocTotal !== amt}>Submit for Director approval</Submit>
        </div>
        <p className="w-full text-xs text-slate-500">Submitted payments stay <b>Pending Director Approval</b>: they do not change the student&apos;s balance or collections, and no receipt is issued until approved.</p>
      </div>
    </ActionForm>
  );
}
