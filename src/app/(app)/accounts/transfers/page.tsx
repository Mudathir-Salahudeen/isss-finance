import { requirePage } from "@/server/session";
import { runReport } from "@/server/reports";
import { accessibleAccounts } from "@/server/services/accounts";
import { PageHeader, Card, StatusBadge } from "@/components/ui";
import { DataTable, SP } from "@/components/DataTable";
import { ActionForm, Submit, ReasonAction, Idempotency } from "@/components/client/forms";
import { transferAction, reverseTransferAction } from "../actions";
import { can } from "@/server/actor";
import { todayISO } from "@/lib/dates";

export const metadata = { title: "Transfers" };
export default async function Transfers({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("accounts.view");
  const sp = await searchParams;
  const r = await runReport(a, "transfers", {});
  const accs = can(a, "transfers.create") ? await accessibleAccounts(a) : [];
  return (
    <>
      <PageHeader title="Transfers between accounts" subtitle="E.g. lodging cash into the bank. Transfers are never income or expenses." />
      {can(a, "transfers.create") && (
        <Card title="Record a transfer" className="mb-4">
          <ActionForm action={transferAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3"><Idempotency />
            <div><label htmlFor="fa" className="mb-1 block">From</label><select id="fa" name="fromAccountId" required>{accs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label htmlFor="ta" className="mb-1 block">To</label><select id="ta" name="toAccountId" required>{accs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label htmlFor="am" className="mb-1 block">Amount (₦)</label><input id="am" name="amount" inputMode="decimal" required /></div>
            <div><label htmlFor="td" className="mb-1 block">Date</label><input id="td" name="transferDate" type="date" defaultValue={todayISO()} max={todayISO()} required /></div>
            <div><label htmlFor="rf" className="mb-1 block">Reference / deposit slip</label><input id="rf" name="reference" /></div>
            <div><label htmlFor="nt" className="mb-1 block">Notes</label><input id="nt" name="notes" /></div>
            <div><Submit>Record transfer</Submit></div>
          </ActionForm>
        </Card>
      )}
      <DataTable path="/accounts/transfers" sp={sp} rows={r.rows} exportKey="transfers" canExport={r.canExport}
        columns={[{ key: "transfer_date", label: "Date", type: "date" }, { key: "from_name", label: "From" }, { key: "to_name", label: "To" }, { key: "amount", label: "Amount", type: "money" },
          { key: "reference", label: "Ref." }, { key: "notes", label: "Notes" }, { key: "status", label: "Status", render: (x) => <StatusBadge status={String(x.status)} /> }, { key: "created_by_name", label: "By" },
          { key: "id", label: "", sortable: false, render: (x) => x.status === "posted" && can(a, "transfers.create") ? <ReasonAction action={reverseTransferAction} className="btn-ghost btn-sm" label="Reverse" title="Reverse transfer" hidden={{ id: String(x.id) }} /> : null }]} />
    </>
  );
}
