import { requirePage } from "@/server/session";
import { listAccounts } from "@/server/services/accounts";
import { PageHeader } from "@/components/ui";
import { StatementImport } from "@/components/client/StatementImport";

export default async function ImportStatement({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  await requirePage("recon.manage");
  const accs = (await listAccounts({ activeOnly: true })).filter((a) => a.type !== "cash");
  return (<><PageHeader title="Import bank statement" back={{ href: "/reconciliation", label: "Reconciliation" }} subtitle="Upload a CSV/Excel export from your bank, map its columns, then match it against the book." />
    <StatementImport accounts={accs} defaultAccountId={Number((await searchParams).accountId) || undefined} /></>);
}
