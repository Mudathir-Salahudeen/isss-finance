"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runPromotion } from "@/app/(app)/promotion/actions";
import type { PreviewRow, PromotionAction } from "@/server/services/promotion";

type Row = PreviewRow & { action: PromotionAction; reason: string };
export function PromotionGrid({ rows, classes, arms, fromSessionId, toSessionId, toSessionName }: {
  rows: PreviewRow[]; classes: { id: number; name: string }[]; arms: { id: number; classId: number; name: string }[]; fromSessionId: number; toSessionId: number; toSessionName: string;
}) {
  const [data, setData] = useState<Row[]>(rows.map((r) => ({ ...r, action: r.proposedAction, reason: "" })));
  const [result, setResult] = useState<{ error?: string; results?: { studentId: number; ok: boolean; message: string; action: string }[]; done?: number; failed?: number } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const upd = (i: number, p: Partial<Row>) => setData((d) => d.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const counts = data.reduce((m, r) => ({ ...m, [r.action]: (m[r.action] ?? 0) + 1 }), {} as Record<string, number>);
  const problems = data.filter((r) => (r.action === "promote" && (!r.toClassId || (arms.some((a) => a.classId === r.toClassId) && !r.toArmId))) || (["transfer", "withdraw"].includes(r.action) && !r.reason.trim()));
  const submit = () => {
    if (!window.confirm(`Confirm progression into ${toSessionName}?\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("\n")}`)) return;
    start(async () => {
      const r = await runPromotion({ fromSessionId, toSessionId, decisions: data.map((x) => ({ studentId: x.studentId, action: x.action, toClassId: x.action === "promote" ? x.toClassId : undefined, toArmId: x.action === "promote" || x.action === "repeat" ? x.toArmId ?? undefined : undefined, reason: x.reason })) });
      setResult(r);
      router.refresh();
    });
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">{Object.entries(counts).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-2 py-0.5">{k}: <b>{v}</b></span>)}</div>
      <div className="overflow-x-auto"><table>
        <thead><tr>{["Student", "Current", "Status", "Decision", "Destination class", "Arm", "Reason / note"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{data.map((r, i) => {
          const res = result?.results?.find((x) => x.studentId === r.studentId);
          const destArms = arms.filter((a) => a.classId === (r.action === "repeat" ? r.fromClassId : r.toClassId));
          return (
            <tr key={r.studentId} className={res ? (res.ok ? "bg-emerald-50" : "bg-rose-50") : ""}>
              <td className="td">{r.name}<div className="text-xs text-slate-500">{r.admissionNo}</div>{res && <div className={`text-xs ${res.ok ? "text-emerald-700" : "text-rose-700"}`}>{res.message}</div>}
                {r.issue && !res && <div className="text-xs text-amber-700">{r.issue}</div>}</td>
              <td className="td">{r.fromClassName} {r.fromArmName}</td>
              <td className="td text-xs">{r.status}</td>
              <td className="td"><select aria-label="Decision" value={r.action} onChange={(e) => upd(i, { action: e.target.value as PromotionAction })} className="w-32">
                {["promote", "repeat", "graduate", "transfer", "withdraw", "skip"].map((x) => <option key={x} value={x}>{x === "skip" ? "Decide later" : x[0].toUpperCase() + x.slice(1)}</option>)}</select></td>
              <td className="td">{r.action === "promote" ? <select aria-label="Destination class" value={r.toClassId ?? ""} onChange={(e) => upd(i, { toClassId: Number(e.target.value) || null, toArmId: null })} className="w-32">
                <option value="">Choose…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : r.action === "repeat" ? r.fromClassName : "—"}</td>
              <td className="td">{(r.action === "promote" || r.action === "repeat") && destArms.length ? <select aria-label="Arm" value={r.action === "repeat" ? r.toArmId ?? r.fromArmId ?? "" : r.toArmId ?? ""} onChange={(e) => upd(i, { toArmId: Number(e.target.value) || null })} className="w-24">
                <option value="">Choose…</option>{destArms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select> : "—"}</td>
              <td className="td"><input aria-label="Reason" value={r.reason} onChange={(e) => upd(i, { reason: e.target.value })} placeholder={["transfer", "withdraw"].includes(r.action) ? "Required" : "Optional"} className="w-40" /></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {result?.error && <div role="alert" className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{result.error}</div>}
      {result?.results && <div role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{result.done} student(s) progressed. {result.failed ? `${result.failed} could not be processed (see highlighted rows).` : ""} Re-running is safe: students already progressed are never promoted twice.</div>}
      {problems.length > 0 && <p className="mt-3 text-sm text-amber-700">{problems.length} row(s) need a destination class/arm or a reason before they can be processed.</p>}
      <div className="mt-4 flex gap-2"><button className="btn-primary" disabled={pending || problems.length > 0 || !data.length} onClick={submit}>{pending ? "Processing…" : `Confirm progression into ${toSessionName}`}</button></div>
    </div>
  );
}
