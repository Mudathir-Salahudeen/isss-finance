import { Field } from "./ui";
import { Submit } from "./client/forms";
type Acc = { id?: number; name?: string; provider?: string | null; accountNumber?: string | null; type?: string; openingBalance?: number; openingDate?: string | null; active?: boolean; restricted?: boolean; custodianUserId?: number | null };
export function AccountFields({ acc = {}, users, assigned = [] }: { acc?: Acc; users: { id: number; fullName: string }[]; assigned?: number[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {acc.id && <input type="hidden" name="id" value={acc.id} />}
      <Field label="Account name" name="name" required><input id="name" name="name" defaultValue={acc.name} required placeholder="e.g. GTBank — School Fees" /></Field>
      <Field label="Type" name="type"><select id="type" name="type" defaultValue={acc.type ?? "bank"}><option value="bank">Bank</option><option value="cash">Cash</option><option value="pos">POS settlement</option><option value="other">Other</option></select></Field>
      <Field label="Bank / provider" name="provider"><input id="provider" name="provider" defaultValue={acc.provider ?? ""} /></Field>
      <Field label="Account number" name="accountNumber" hint="Shown masked elsewhere"><input id="accountNumber" name="accountNumber" defaultValue={acc.accountNumber ?? ""} /></Field>
      <Field label="Opening balance (₦)" name="openingBalance"><input id="openingBalance" name="openingBalance" inputMode="decimal" defaultValue={acc.openingBalance !== undefined ? (acc.openingBalance / 100).toFixed(2) : "0"} /></Field>
      <Field label="Opening balance date" name="openingDate"><input id="openingDate" name="openingDate" type="date" defaultValue={acc.openingDate ?? ""} /></Field>
      <Field label="Cash custodian (accountable cashier)" name="custodianUserId"><select id="custodianUserId" name="custodianUserId" defaultValue={acc.custodianUserId ?? ""}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
      <Field label="Status" name="active"><select id="active" name="active" defaultValue={acc.active === false ? "0" : "1"}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
      <div className="sm:col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" defaultChecked={acc.restricted} /> Restrict use of this account to selected users</label>
        <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-slate-100 p-2 text-sm sm:grid-cols-3">{users.map((u) => <label key={u.id} className="flex items-center gap-2"><input type="checkbox" name="userIds" value={u.id} defaultChecked={assigned.includes(u.id)} /> {u.fullName}</label>)}</div></div>
      <div className="sm:col-span-2"><Submit>{acc.id ? "Save account" : "Create account"}</Submit></div>
    </div>
  );
}
