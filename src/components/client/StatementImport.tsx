"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewStatement } from "@/app/(app)/reconciliation/actions";

const FIELDS = [["date", "Transaction date *"], ["description", "Description"], ["reference", "Reference"], ["credit", "Credit (in)"], ["debit", "Debit (out)"], ["amount", "Signed amount"], ["balance", "Running balance"]];
const fmt = (k: number | null) => (k === null ? "" : `₦${(k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);
type Prev = { headers: string[]; mapping: Record<string, string>; rows: { row: number; date: string | null; description: string; reference: string; amount: number | null; error?: string }[]; total: number; errors: number };

export function StatementImport({ accounts, defaultAccountId }: { accounts: { id: number; name: string }[]; defaultAccountId?: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id);
  const [prev, setPrev] = useState<Prev | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (m?: Record<string, string>, commit = false) => start(async () => {
    if (!file) return;
    const fd = new FormData(); fd.set("file", file); fd.set("accountId", String(accountId));
    if (m) fd.set("mapping", JSON.stringify(m));
    if (commit) fd.set("commit", "1");
    const r = await previewStatement(fd);
    if ("error" in r && r.error) return setErr(r.error);
    setErr(null);
    if ("committed" in r && r.committed) return router.push(`/reconciliation/account/${accountId}?imported=${r.committed.imported}&dups=${r.committed.duplicates}`);
    setPrev(r as Prev); setMapping((r as Prev).mapping);
  });
  return (
    <div className="space-y-4">
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
      <div className="card grid gap-3 p-5 sm:grid-cols-3">
        <div><label htmlFor="acc" className="mb-1 block">Bank account</label><select id="acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label htmlFor="sf" className="mb-1 block">Statement (.xlsx / .csv)</label><input id="sf" type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPrev(null); }} /></div>
        <div className="flex items-end gap-2"><button className="btn-primary" disabled={!file || pending} onClick={() => run()}>{pending ? "Reading…" : "Preview"}</button><a className="btn-secondary" href="/api/templates/bank_statement">Template</a></div>
      </div>
      {prev && (
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold">Column mapping</h2>
          <div className="grid gap-3 sm:grid-cols-4">{FIELDS.map(([k, l]) => (
            <div key={k}><label htmlFor={`m${k}`} className="mb-1 block text-xs">{l}</label><select id={`m${k}`} value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}><option value="">—</option>{prev.headers.map((h) => <option key={h}>{h}</option>)}</select></div>))}</div>
          <button className="btn-secondary mt-3" onClick={() => run(mapping)} disabled={pending}>Apply mapping</button>
          <p className="mt-3 text-sm">{prev.total} line(s) read · {prev.errors} with errors (will be skipped)</p>
          <div className="mt-2 max-h-80 overflow-auto"><table><thead><tr>{["Row", "Date", "Description", "Reference", "Amount", "Problem"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{prev.rows.map((r) => <tr key={r.row} className={r.error ? "bg-rose-50" : ""}><td className="td">{r.row}</td><td className="td">{r.date}</td><td className="td text-xs">{r.description}</td><td className="td text-xs">{r.reference}</td><td className={`td num ${(r.amount ?? 0) < 0 ? "text-rose-600" : ""}`}>{fmt(r.amount)}</td><td className="td text-xs text-rose-700">{r.error}</td></tr>)}</tbody></table></div>
          <button className="btn-primary mt-4" disabled={pending || prev.total - prev.errors === 0} onClick={() => run(mapping, true)}>{pending ? "Importing…" : `Import ${prev.total - prev.errors} line(s)`}</button>
          <p className="mt-2 text-xs text-slate-500">Lines identical to ones already imported are flagged as duplicates and kept out of matching.</p>
        </div>
      )}
    </div>
  );
}
