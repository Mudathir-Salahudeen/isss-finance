import { requirePage } from "@/server/session";
import { getSettings, listChannels } from "@/server/services/admin";
import { PageHeader, Card, Field, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { settingsAction, logoAction, channelAction } from "../actions";

export const metadata = { title: "Settings" };
export default async function Settings() {
  await requirePage("settings.manage");
  const s = await getSettings();
  const ch = await listChannels();
  return (
    <>
      <PageHeader title="School settings & policies" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="School profile & controls" className="lg:col-span-2">
          <ActionForm action={settingsAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="School name" name="schoolName" required><input id="schoolName" name="schoolName" defaultValue={s.schoolName} required /></Field>
              <Field label="Phone" name="phone"><input id="phone" name="phone" defaultValue={s.phone ?? ""} /></Field>
              <Field label="Address" name="address"><input id="address" name="address" defaultValue={s.address ?? ""} /></Field>
              <Field label="Email" name="email"><input id="email" name="email" defaultValue={s.email ?? ""} /></Field>
              <Field label="Currency symbol" name="currencySymbol" hint="Amounts are stored in Naira (kobo)."><input id="currencySymbol" name="currencySymbol" defaultValue={s.currencySymbol} /></Field>
              <Field label="Date display" name="dateFormat"><select id="dateFormat" name="dateFormat" defaultValue={s.dateFormat}>{["dd/MM/yyyy", "dd-MM-yyyy", "dd MMM yyyy", "yyyy-MM-dd"].map((f) => <option key={f}>{f}</option>)}</select></Field>
              <Field label="Receipt number prefix" name="receiptPrefix"><input id="receiptPrefix" name="receiptPrefix" defaultValue={s.receiptPrefix} /></Field>
              <Field label="Receipt footer" name="receiptFooter"><input id="receiptFooter" name="receiptFooter" defaultValue={s.receiptFooter ?? ""} /></Field>
              <Field label="Flag payments at or above (₦)" name="largePaymentThreshold"><input id="largePaymentThreshold" name="largePaymentThreshold" defaultValue={(s.largePaymentThreshold / 100).toFixed(2)} /></Field>
              <Field label="Debtor ageing bands (days)" name="ageingBands" hint="e.g. 30,60,90"><input id="ageingBands" name="ageingBands" defaultValue={s.ageingBands.join(",")} /></Field>
            </div>
            <fieldset className="space-y-2 rounded-xl border border-slate-100 p-4"><legend className="px-1 text-sm font-semibold">Approval controls</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowSelfApprovalPayments" defaultChecked={s.allowSelfApprovalPayments} /> Allow a user to approve a student payment they recorded themselves (not recommended)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowSelfApprovalExpenses" defaultChecked={s.allowSelfApprovalExpenses} /> Allow self-approval of expenses and payroll (when off, the Director&apos;s own expenses need a second approver)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="receiptShowApprover" defaultChecked={s.receiptShowApprover} /> Show approver name on receipts</label>
            </fieldset>
            <Submit>Save settings</Submit>
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card title="Logo">
            {s.logoPath && <img src="/api/logo" alt="School logo" className="mb-3 h-16" />}
            <ActionForm action={logoAction} className="space-y-2"><input name="logo" type="file" accept="image/png,image/jpeg" required aria-label="Logo file" /><Submit className="btn-secondary">Upload logo</Submit></ActionForm>
          </Card>
          <Card title="Payment channels">
            <ul className="mb-3 space-y-1 text-sm">{ch.map((c) => <li key={c.id} className="flex items-center justify-between"><span>{c.name}</span><span className="flex gap-1">{c.requiresReference && <Badge>ref</Badge>}{c.requiresEvidence && <Badge tone="sky">evidence</Badge>}{!c.active && <Badge tone="rose">off</Badge>}</span></li>)}</ul>
            <ActionForm action={channelAction} resetOnSuccess className="space-y-2">
              <select name="id" aria-label="Channel"><option value="">New channel</option>{ch.map((c) => <option key={c.id} value={c.id}>Edit: {c.name}</option>)}</select>
              <input name="name" placeholder="Name (e.g. Paystack)" required aria-label="Name" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresReference" defaultChecked /> Requires reference</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresEvidence" /> Requires evidence</label>
              <select name="active" aria-label="Status"><option value="1">Active</option><option value="0">Inactive</option></select>
              <Submit className="btn-secondary">Save channel</Submit>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
