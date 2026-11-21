"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stageAction, validateAction, commitAction, saveProfileAction } from "@/app/(app)/imports/actions";
import type { FieldDef, ImportKind, RowResult } from "@/server/services/imports";

type Staged = { token: string; fileName: string; headers: string[]; sample: (string | number | null)[][]; rowCount: number; mapping: Record<string, string>; profiles: { id: number; name: string; mapping: Record<string, string> }[] };
type Val = { rows: RowResult[]; counts: { total: number; create: number; update: number; skip: number; error: number; warnings: number } };

export function ImportWizard({ kind, fields, sessions, canUpdate, defaultSessionId }: { kind: ImportKind; fields: FieldDef[]; sessions: { id: number; name: string }[]; canUpdate: boolean; defaultSessionId?: number }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [val, setVal] = useState<Val | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opts, setOpts] = useState({ sessionId: defaultSessionId, updateExisting: false, skipPossibleDuplicates: false });
  const [profileName, setProfileName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const needsSession = kind !== "staff";
  const upload = (fd: FormData) => start(async () => {
    setErr(null); setVal(null);
    fd.set("kind", kind);
    const r = await stageAction(fd);
    if (!r.ok) return setErr(r.error);
    setStaged(r.data as Staged); setMapping((r.data as Staged).mapping);
  });
  const validate = () => start(async () => { setErr(null); const r = await validateAction(staged!.token, mapping, opts); if (!r.ok) return setErr(r.error); setVal(r.data as Val); });
  const commit = () => start(async () => {
    if (!window.confirm(`Import ${val!.counts.create} new${val!.counts.update ? ` and update ${val!.counts.update}` : ""} record(s)? ${val!.counts.error} row(s) with errors and ${val!.counts.skip} skipped row(s) will not be imported.`)) return;
    const r = await commitAction(staged!.token, mapping, opts);
    if (!r.ok) return setErr(r.error);
    router.push(`/imports/${r.data}`);
  });
  return (
    <div className="space-y-4">
      {err && <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">1. Upload file</h2>
        <form action={upload} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><label htmlFor="file" className="mb-1 block">Excel (.xlsx) or CSV file</label><input id="file" name="file" type="file" accept=".xlsx,.csv" required /></div>
          <button className="btn-primary" disabled={pending}>{pending && !staged ? "Reading…" : "Upload & preview"}</button>
          <a className="btn-secondary" href={`/api/templates/${kind}`}>Download template</a>
        </form>
      </section>
      {staged && (
        <section className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">2. Map columns — {staged.fileName} ({staged.rowCount} rows)</h2>
          {staged.profiles.length > 0 && (
            <div className="mb-3 flex items-center gap-2 text-sm">Use saved mapping:
              {staged.profiles.map((p) => <button key={p.id} type="button" className="btn-secondary btn-sm" onClick={() => setMapping(Object.fromEntries(Object.entries(p.mapping).filter(([, h]) => staged.headers.includes(h))))}>{p.name}</button>)}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <div key={f.key}><label htmlFor={`m-${f.key}`} className="mb-1 block">{f.label}{f.required && <span className="text-rose-600"> *</span>}</label>
                <select id={`m-${f.key}`} value={mapping[f.key] ?? ""} onChange={(e) => { setVal(null); setMapping({ ...mapping, [f.key]: e.target.value }); }}>
                  <option value="">— not in file —</option>{staged.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select></div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2"><div className="w-56"><label htmlFor="pn" className="mb-1 block text-xs">Save this mapping as</label><input id="pn" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Old school software export" /></div>
            <button type="button" className="btn-secondary" disabled={!profileName} onClick={() => start(async () => { const r = await saveProfileAction(kind, profileName, mapping); if (!r.ok) setErr(r.error); else setProfileName(""); })}>Save mapping</button></div>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">File preview</h3>
          <div className="overflow-x-auto"><table><thead><tr>{staged.headers.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{staged.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="td text-xs">{c === null ? "" : String(c)}</td>)}</tr>)}</tbody></table></div>
          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3">
            {needsSession && <div className="w-48"><label htmlFor="ses" className="mb-1 block">Academic session</label><select id="ses" value={opts.sessionId ?? ""} onChange={(e) => { setVal(null); setOpts({ ...opts, sessionId: Number(e.target.value) || undefined }); }}><option value="">Choose…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            {kind === "students" && <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opts.updateExisting} disabled={!canUpdate} onChange={(e) => { setVal(null); setOpts({ ...opts, updateExisting: e.target.checked }); }} /> Update existing students (non-blank cells only){!canUpdate && " — needs permission"}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opts.skipPossibleDuplicates} onChange={(e) => { setVal(null); setOpts({ ...opts, skipPossibleDuplicates: e.target.checked }); }} /> Skip possible duplicate names</label>
            </>}
            <button type="button" className="btn-primary" onClick={validate} disabled={pending}>{pending ? "Checking…" : "3. Validate"}</button>
          </div>
        </section>
      )}
      {val && (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">4. Review & import</h2>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded bg-emerald-100 px-2 py-0.5">Will create: <b>{val.counts.create}</b></span>
            {val.counts.update > 0 && <span className="rounded bg-sky-100 px-2 py-0.5">Will update: <b>{val.counts.update}</b></span>}
            <span className="rounded bg-slate-100 px-2 py-0.5">Skipped: <b>{val.counts.skip}</b></span>
            <span className="rounded bg-rose-100 px-2 py-0.5">Errors: <b>{val.counts.error}</b></span>
            <span className="rounded bg-amber-100 px-2 py-0.5">Warnings: <b>{val.counts.warnings}</b></span>
          </div>
          <div className="max-h-96 overflow-auto"><table><thead><tr><th className="th">Row</th><th className="th">Outcome</th><th className="th">Message</th><th className="th">Data</th></tr></thead>
            <tbody>{val.rows.filter((r) => r.outcome !== "create" || r.warnings.length).slice(0, 500).map((r) => (
              <tr key={r.row} className={r.outcome === "error" ? "bg-rose-50" : r.warnings.length ? "bg-amber-50" : ""}><td className="td">{r.row}</td><td className="td">{r.outcome}</td><td className="td text-xs">{r.message}{r.warnings.length > 0 && r.outcome !== "skip" && <div className="text-amber-700">{r.warnings.join("; ")}</div>}</td>
                <td className="td text-xs text-slate-500">{Object.values(r.data).filter(Boolean).slice(0, 5).join(" · ")}</td></tr>))}</tbody></table>
            {val.rows.every((r) => r.outcome === "create" && !r.warnings.length) && <p className="p-3 text-sm text-emerald-700">All rows are valid.</p>}</div>
          <button className="btn-success mt-4" onClick={commit} disabled={pending || val.counts.create + val.counts.update === 0}>{pending ? "Importing…" : `Import ${val.counts.create + val.counts.update} row(s)`}</button>
        </section>
      )}
    </div>
  );
}
