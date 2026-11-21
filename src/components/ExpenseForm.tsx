import { Field } from "./ui";
import { Submit, Idempotency } from "./client/forms";
type E = { id?: number; title?: string; description?: string | null; categoryId?: number; subcategory?: string | null; amount?: number; dateIncurred?: string; vendorId?: number | null; payeeName?: string | null; paymentMethod?: string | null; accountId?: number | null; recurring?: boolean; recurrence?: string | null; department?: string | null };
export function ExpenseFields({ e = {}, cats, vendors, accounts, today, edit }: { e?: E; cats: { id: number; name: string; parentId: number | null }[]; vendors: { id: number; name: string }[]; accounts: { id: number; name: string }[]; today: string; edit?: boolean }) {
  return (
    <div className="space-y-4">
      {e.id ? <input type="hidden" name="id" value={e.id} /> : <Idempotency />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Expense title" name="title" required className="sm:col-span-2"><input id="title" name="title" defaultValue={e.title} required /></Field>
        <Field label="Amount (₦)" name="amount" required><input id="amount" name="amount" inputMode="decimal" required defaultValue={e.amount ? (e.amount / 100).toFixed(2) : ""} /></Field>
        <Field label="Category" name="categoryId" required><select id="categoryId" name="categoryId" defaultValue={e.categoryId} required>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>)}</select></Field>
        <Field label="Subcategory" name="subcategory"><input id="subcategory" name="subcategory" defaultValue={e.subcategory ?? ""} /></Field>
        <Field label="Date incurred" name="dateIncurred" required><input id="dateIncurred" name="dateIncurred" type="date" defaultValue={e.dateIncurred ?? today} required /></Field>
        <Field label="Vendor" name="vendorId"><select id="vendorId" name="vendorId" defaultValue={e.vendorId ?? ""}><option value="">— none / one-off payee —</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Payee (if no vendor)" name="payeeName"><input id="payeeName" name="payeeName" defaultValue={e.payeeName ?? ""} /></Field>
        <Field label="Department" name="department"><input id="department" name="department" defaultValue={e.department ?? ""} /></Field>
        <Field label="Payment method" name="paymentMethod"><select id="paymentMethod" name="paymentMethod" defaultValue={e.paymentMethod ?? "Bank Transfer"}>{["Bank Transfer", "Cash", "Cheque", "POS", "Other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Pay from account" name="accountId"><select id="accountId" name="accountId" defaultValue={e.accountId ?? ""}><option value="">Decide at payment</option>{accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Recurs" name="recurrence"><select id="recurrence" name="recurrence" defaultValue={e.recurrence ?? ""}><option value="">—</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="termly">Termly</option><option value="yearly">Yearly</option></select></Field>
        <Field label="Description" name="description" className="sm:col-span-3"><textarea id="description" name="description" rows={2} defaultValue={e.description ?? ""} /></Field>
        {!edit && <Field label="Invoice / receipt (image or PDF)" name="evidence" className="sm:col-span-2"><input id="evidence" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></Field>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" defaultChecked={e.recurring} /> This is a recurring expense</label>
      <div className="flex gap-2">{edit ? <Submit>Save draft</Submit> : <><Submit className="btn-secondary" name="intent" value="draft">Save as draft</Submit><Submit name="intent" value="submit">Submit for approval</Submit></>}</div>
    </div>
  );
}
