import { requirePage } from "@/server/session";
import { listChannels } from "@/server/services/admin";
import { accessibleAccounts } from "@/server/services/accounts";
import { getStructure } from "@/server/services/academics";
import { listStudents } from "@/server/services/students";
import { PageHeader, Alert } from "@/components/ui";
import { PaymentForm } from "@/components/client/PaymentForm";
import { todayISO } from "@/lib/dates";
import Link from "next/link";
import { can } from "@/server/actor";
import { db } from "@/db";
import { students } from "@/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Record payment" };
export default async function NewPayment({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const a = await requirePage("payments.create");
  const sid = Number((await searchParams).studentId) || null;
  const [channels, accounts, st] = await Promise.all([listChannels(), accessibleAccounts(a), getStructure()]);
  let initial = null;
  if (sid) {
    const [s] = await db.select().from(students).where(eq(students.id, sid));
    const row = s ? (await listStudents({ q: s.admissionNo }))[0] : null;
    if (row) initial = { id: row.id, label: `${row.lastName}, ${row.firstName}`, admissionNo: row.admissionNo, className: `${row.className ?? ""} ${row.armName ?? ""}`, status: row.status };
  }
  return (
    <>
      <PageHeader title="Record student payment" back={{ href: "/payments", label: "Payments" }} />
      {!accounts.length ? (can(a, "accounts.manage")
        ? <Alert tone="warn" title="Register the school's accounts first">Every payment must say which bank, cash or POS account received the money, and none have been set up yet. <Link className="link font-semibold" href="/accounts">Go to Bank &amp; cash accounts →</Link></Alert>
        : <Alert tone="warn">No receiving accounts are available to you yet. Ask the Director to register the school&apos;s bank/cash accounts, or to give you access to one.</Alert>) :
        <PaymentForm channels={channels.filter((c) => c.active)} accounts={accounts} sessions={st.sessions} terms={st.terms} initialStudent={initial} today={todayISO()} />}
    </>
  );
}
