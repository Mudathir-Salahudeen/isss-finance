import { Field } from "./ui";
import { Submit } from "./client/forms";

type Fee = { id?: number; name?: string; description?: string | null; categoryId?: number; amount?: number; sessionId?: number; termId?: number | null; mandatory?: boolean; dueDate?: string | null; allowPartial?: boolean; recurring?: boolean; frequency?: string | null; status?: string };
export function FeeFields({ fee = {}, cats, sessions, terms, classes, classAmounts = [], locked = false }: { fee?: Fee; cats: { id: number; name: string }[]; sessions: { id: number; name: string; isCurrent: boolean }[];
  terms: { id: number; sessionId: number; name: string }[]; classes: { id: number; name: string }[]; classAmounts?: { classId: number; amount: number }[]; locked?: boolean }) {
  const amt = (k?: number) => (k === undefined ? "" : (k / 100).toFixed(2));
  return (
    <div className="space-y-4">
      {fee.id && <input type="hidden" name="id" value={fee.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fee name" name="name" required className="sm:col-span-2"><input id="name" name="name" defaultValue={fee.name} required placeholder="e.g. PTA Levy, Cultural Day, Excursion" /></Field>
        <Field label="Category" name="categoryId" required><select id="categoryId" name="categoryId" defaultValue={fee.categoryId} required>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Description" name="description" className="sm:col-span-3"><input id="description" name="description" defaultValue={fee.description ?? ""} /></Field>
        <Field label="Default amount (₦)" name="amount" required hint={locked ? "Locked: students have been charged." : undefined}><input id="amount" name="amount" inputMode="decimal" defaultValue={amt(fee.amount)} required readOnly={locked} /></Field>
        <Field label="Academic session" name="sessionId" required><select id="sessionId" name="sessionId" defaultValue={fee.sessionId ?? sessions.find((s) => s.isCurrent)?.id} disabled={locked}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Term" name="termId" hint="Leave blank for a whole-session fee"><select id="termId" name="termId" defaultValue={fee.termId ?? ""} disabled={locked}><option value="">Whole session</option>{terms.map((t) => <option key={t.id} value={t.id}>{sessions.find((s) => s.id === t.sessionId)?.name} — {t.name}</option>)}</select></Field>
        {locked && <><input type="hidden" name="sessionId" value={fee.sessionId} /><input type="hidden" name="termId" value={fee.termId ?? ""} /></>}
        <Field label="Due date" name="dueDate"><input id="dueDate" name="dueDate" type="date" defaultValue={fee.dueDate ?? ""} /></Field>
        <Field label="Status" name="status"><select id="status" name="status" defaultValue={fee.status === "cancelled" ? "inactive" : fee.status ?? "draft"}><option value="draft">Draft</option><option value="active">Active (can be assigned)</option><option value="inactive">Inactive</option></select></Field>
        <Field label="Frequency (if recurring)" name="frequency"><select id="frequency" name="frequency" defaultValue={fee.frequency ?? ""}><option value="">—</option><option value="termly">Termly</option><option value="sessional">Every session</option><option value="monthly">Monthly</option></select></Field>
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="mandatory" defaultChecked={fee.mandatory ?? true} /> Mandatory</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="allowPartial" defaultChecked={fee.allowPartial ?? true} /> Allow part payment</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="recurring" defaultChecked={fee.recurring ?? false} /> Recurring</label>
      </div>
      <details open={classAmounts.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Class-specific amounts (optional)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          {classes.map((c) => (<div key={c.id}><label htmlFor={`class_${c.id}`} className="mb-1 block text-xs">{c.name}</label><input id={`class_${c.id}`} name={`class_${c.id}`} inputMode="decimal" readOnly={locked} placeholder="default" defaultValue={amt(classAmounts.find((x) => x.classId === c.id)?.amount)} /></div>))}
        </div>
      </details>
      <Submit>{fee.id ? "Save changes" : "Create fee"}</Submit>
    </div>
  );
}
