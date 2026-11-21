import Link from "next/link";
import { requirePage } from "@/server/session";
import { myNotifications } from "@/server/services/auditlog";
import { PageHeader, Card, DT } from "@/components/ui";
import { InlineAction } from "@/components/client/forms";
import { markReadAction } from "../admin/actions";

export const metadata = { title: "Notifications" };
export default async function Notifications() {
  const a = await requirePage();
  const rows = await myNotifications(a);
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app alerts. Email/SMS/WhatsApp delivery is not connected yet." actions={<InlineAction action={markReadAction} label="Mark all read" className="btn-secondary" />} />
      <Card pad={false}>
        <ul className="divide-y divide-slate-100">{rows.map((n) => (
          <li key={n.id} className={`flex items-start justify-between gap-3 px-5 py-3 ${n.isRead ? "" : "bg-brand-50/50"}`}>
            <div><div className="text-sm font-medium">{n.link ? <Link className="link" href={n.link}>{n.title}</Link> : n.title}</div><div className="text-xs text-slate-500">{n.message} · <DT d={n.createdAt} /></div></div>
            {!n.isRead && <InlineAction action={markReadAction} label="Mark read" hidden={{ id: n.id }} className="btn-ghost btn-sm" />}
          </li>))}</ul>
        {!rows.length && <p className="p-5 text-sm text-slate-500">No notifications.</p>}
      </Card>
    </>
  );
}
