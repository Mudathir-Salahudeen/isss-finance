import { Field } from "./ui";

type S = { admissionNo?: string; firstName?: string; middleName?: string | null; lastName?: string; gender?: string | null; dateOfBirth?: string | null; guardianName?: string | null; guardianPhone?: string | null; guardianEmail?: string | null; guardianAddress?: string | null };
export function StudentFields({ s = {}, errors = {} }: { s?: S; errors?: Record<string, string> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Admission number" name="admissionNo" required error={errors.admissionNo}><input id="admissionNo" name="admissionNo" defaultValue={s.admissionNo} required /></Field>
      <Field label="First name" name="firstName" required><input id="firstName" name="firstName" defaultValue={s.firstName} required /></Field>
      <Field label="Middle name" name="middleName"><input id="middleName" name="middleName" defaultValue={s.middleName ?? ""} /></Field>
      <Field label="Last name / surname" name="lastName" required><input id="lastName" name="lastName" defaultValue={s.lastName} required /></Field>
      <Field label="Gender" name="gender"><select id="gender" name="gender" defaultValue={s.gender ?? ""}><option value="">—</option><option>Female</option><option>Male</option></select></Field>
      <Field label="Date of birth" name="dateOfBirth"><input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={s.dateOfBirth ?? ""} /></Field>
      <Field label="Parent / guardian name" name="guardianName"><input id="guardianName" name="guardianName" defaultValue={s.guardianName ?? ""} /></Field>
      <Field label="Guardian phone" name="guardianPhone"><input id="guardianPhone" name="guardianPhone" type="tel" defaultValue={s.guardianPhone ?? ""} /></Field>
      <Field label="Guardian email" name="guardianEmail"><input id="guardianEmail" name="guardianEmail" type="email" defaultValue={s.guardianEmail ?? ""} /></Field>
      <Field label="Address" name="guardianAddress" className="sm:col-span-3"><input id="guardianAddress" name="guardianAddress" defaultValue={s.guardianAddress ?? ""} /></Field>
    </div>
  );
}
