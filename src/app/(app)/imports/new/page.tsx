import { requirePage } from "@/server/session";
import { IMPORT_FIELDS, ImportKind } from "@/server/services/imports";
import { listSessions } from "@/server/services/academics";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/client/ImportWizard";
import { can } from "@/server/actor";

const TITLES: Record<ImportKind, [string, string]> = {
  students: ["Import students", "students.import"], staff: ["Import staff records", "payroll.manage_staff"],
  fee_assignments: ["Import fee assignments", "fees.assign"], opening_balances: ["Import opening balances", "fees.opening_balance"],
};
export default async function NewImport({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const kind = ((await searchParams).kind ?? "students") as ImportKind;
  const [title, perm] = TITLES[kind] ?? TITLES.students;
  const a = await requirePage(perm);
  const sessions = await listSessions();
  return (
    <>
      <PageHeader title={title} back={{ href: "/imports", label: "Imports" }}
        subtitle={kind === "opening_balances" ? "Brings forward each student's unpaid balance from the previous system as a charge in the chosen session." : kind === "fee_assignments" ? "Charge specific students for an existing fee (e.g. bus fee for bus users). Fees must be created first." : "Nothing is written until you confirm. Existing records are never silently overwritten."} />
      <ImportWizard kind={kind} fields={IMPORT_FIELDS[kind]} sessions={sessions} canUpdate={can(a, "students.import_update")} defaultSessionId={sessions.find((s) => s.isCurrent)?.id} />
    </>
  );
}
