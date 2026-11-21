import Link from "next/link";
import { requireAnyPage } from "@/server/session";
import { listPayments } from "@/server/services/payments";
import { getStructure } from "@/server/services/academics";
import { listAccounts } from "@/server/services/accounts";
import { listChannels, listUsers } from "@/server/services/admin";
import { listFees } from "@/server/services/fees";
import { DataTable, FilterBar, SP, sp1, flat } from "@/components/DataTable";
import { PageHeader, Tabs, N, Badge, StatusBadge } from "@/components/ui";
import { can } from "@/server/actor";
import { parseDateInput } from "@/lib/dates";

export const metadata = { title: "Payments" };
export default async function Payments({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requireAnyPage("payments.view", "payments.approve");
  const sp = await searchParams;
  const status = sp1(sp, "status") ?? "";
  const p = flat(sp);
  const f = { q: p.q, status: status || undefined, sessionId: Number(p.sessionId) || undefined, termId: Number(p.termId) || undefined, accountId: Number(p.accountId) || undefined,
    channelId: Number(p.channelId) || undefined, recordedBy: Number(p.recordedBy) || undefined, from: parseDateInput(p.from) ?? undefined, to: parseDateInput(p.to) ?? undefined,
    classId: Number(p.classId) || undefined, feeId: Number(p.feeId) || undefined };
  const [rows, all, st, accounts, channels, users, fees] = await Promise.all([listPayments(a, f), listPayments(a, { ...f, status: undefined }), getStructure(), listAccounts(), listChannels(), can(a, "users.manage") || can(a, "payments.approve") ? listUsers() : Promise.resolve([]), listFees({})]);
  const count = (s: string) => all.filter((r) => r.status === s).length;
  const tab = (s: string, l: string) => ({ key: s || "all", label: l, count: s ? count(s) : all.length, href: `/payments?${new URLSearchParams({ ...Object.fromEntries(Object.entries(p).filter(([k, v]) => v && !["status", "page"].includes(k))) as Record<string, string>, ...(s ? { status: s } : {}) })}` });
  const reportKey = status === "pending" ? "pending" : status === "rejected" ? "rejected" : status === "approved" ? "collections" : "payments";
  return (
    <>
      <PageHeader title={status === "pending" ? "Pending approvals" : "Payments & receipts"} subtitle="Only approved payments affect balances, collections and receipts."
        actions={can(a, "payments.create") ? <Link className="btn-primary" href="/payments/new">Record payment</Link> : undefined} />
      <Tabs current={status || "all"} tabs={[tab("pending", "Pending approval"), tab("approved", "Approved"), tab("rejected", "Rejected"), tab("reversed", "Reversed"), tab("draft", "Drafts"), tab("", "All")]} />
      <FilterBar path="/payments" sp={sp} keep={["status"]} fields={[
        { name: "q", label: "Search", placeholder: "Student, adm. no., reference, receipt no." },
        { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "sessionId", label: "Session", type: "select", options: st.sessions.map((s) => ({ value: s.id, label: s.name })) },
        { name: "termId", label: "Term", type: "select", options: st.terms.map((t) => ({ value: t.id, label: `${t.name} ${st.sessions.find((s) => s.id === t.sessionId)?.name}` })) },
        { name: "classId", label: "Class", type: "select", options: st.classes.map((c) => ({ value: c.id, label: c.name })) },
        { name: "feeId", label: "Fee", type: "select", options: fees.map((x) => ({ value: x.id, label: `${x.name} (${x.sessionName}${x.termName ? " " + x.termName : ""})` })) },
        { name: "channelId", label: "Method", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
        { name: "accountId", label: "Account", type: "select", options: accounts.map((x) => ({ value: x.id, label: x.name })) },
        ...(users.length ? [{ name: "recordedBy", label: "Recorded by", type: "select" as const, options: users.map((u) => ({ value: u.id, label: u.fullName })) }] : []),
      ]} />
      <DataTable path="/payments" sp={sp} rows={rows as unknown as Record<string, unknown>[]} exportKey={reportKey} canExport={can(a, "reports.export")} rowHref={(r) => `/payments/${r.id}`}
        totals={{ paymentNo: "Total", amount: <N k={rows.reduce((t, r) => t + r.amount, 0)} /> }}
        columns={[
          { key: "paymentNo", label: "Payment / receipt", render: (r) => (r.receiptNo as string) ?? (r.paymentNo as string) },
          { key: "paymentDate", label: "Date", type: "date" },
          { key: "studentName", label: "Student", render: (r) => <>{String(r.studentName)}<div className="text-xs text-slate-500">{String(r.admissionNo)} · {String(r.className ?? "")}</div></> },
          { key: "fees", label: "Fee items", hideOnMobile: true, render: (r) => <span className="text-xs">{String(r.fees ?? "")}</span> },
          { key: "amount", label: "Amount", type: "money" },
          { key: "channelName", label: "Method", hideOnMobile: true, render: (r) => <>{String(r.channelName)}<div className="text-xs text-slate-500">{String(r.reference || "")}</div></> },
          { key: "status", label: "Status", render: (r) => <div className="flex flex-col items-start gap-1"><StatusBadge status={String(r.status)} />
            {r.isLarge ? <Badge tone="rose">Large</Badge> : null}{r.possibleDuplicateOf ? <Badge tone="rose">Possible duplicate</Badge> : null}{r.bankEvidence ? <Badge tone="sky">Seen on bank statement</Badge> : null}</div> },
          { key: "recordedByName", label: "Recorded by", hideOnMobile: true, render: (r) => <span className="text-xs">{String(r.recordedByName)}</span> },
          { key: "evidenceCount", label: "Evidence", type: "number", hideOnMobile: true },
        ]} />
    </>
  );
}
