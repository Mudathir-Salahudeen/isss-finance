import { Field } from "./ui";
import { Submit } from "./client/forms";
type S = { id?: number; staffNo?: string; fullName?: string; department?: string | null; position?: string | null; status?: string; startDate?: string | null; salaryType?: string; bankName?: string | null; bankAccountNumber?: string | null; bankAccountName?: string | null; phone?: string | null; email?: string | null };
export function StaffFields({ s = {} }: { s?: S }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <Field label="Staff ID" name="staffNo" required><input id="staffNo" name="staffNo" defaultValue={s.staffNo} required /></Field>
      <Field label="Full name" name="fullName" required><input id="fullName" name="fullName" defaultValue={s.fullName} required /></Field>
      <Field label="Status" name="status"><select id="status" name="status" defaultValue={s.status ?? "active"}><option value="active">Active</option><option value="on_leave">On leave</option><option value="suspended">Suspended</option><option value="exited">Exited</option></select></Field>
      <Field label="Department" name="department"><input id="department" name="department" defaultValue={s.department ?? ""} /></Field>
      <Field label="Position" name="position"><input id="position" name="position" defaultValue={s.position ?? ""} /></Field>
      <Field label="Start date" name="startDate"><input id="startDate" type="date" name="startDate" defaultValue={s.startDate ?? ""} /></Field>
      <Field label="Salary type" name="salaryType"><select id="salaryType" name="salaryType" defaultValue={s.salaryType ?? "monthly"}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="contract">Contract</option></select></Field>
      {!s.id && <Field label="Basic monthly salary (₦)" name="basic"><input id="basic" name="basic" inputMode="decimal" /></Field>}
      <Field label="Bank" name="bankName"><input id="bankName" name="bankName" defaultValue={s.bankName ?? ""} /></Field>
      <Field label="Account number (NUBAN)" name="bankAccountNumber"><input id="bankAccountNumber" name="bankAccountNumber" inputMode="numeric" maxLength={10} defaultValue={s.bankAccountNumber ?? ""} /></Field>
      <Field label="Account name" name="bankAccountName"><input id="bankAccountName" name="bankAccountName" defaultValue={s.bankAccountName ?? ""} /></Field>
      <Field label="Phone" name="phone"><input id="phone" name="phone" defaultValue={s.phone ?? ""} /></Field>
      <Field label="Email" name="email"><input id="email" name="email" type="email" defaultValue={s.email ?? ""} /></Field>
      <div className="sm:col-span-3"><Submit>{s.id ? "Save staff record" : "Add staff member"}</Submit></div>
    </div>
  );
}
