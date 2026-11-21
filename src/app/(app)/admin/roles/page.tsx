import Link from "next/link";
import { requirePage } from "@/server/session";
import { listRoles } from "@/server/services/admin";
import { PageHeader, Badge } from "@/components/ui";

export const metadata = { title: "Roles" };
export default async function Roles() {
  await requirePage("roles.manage");
  const roles = await listRoles();
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Roles are examples — create any role and choose exactly what it can do. Permissions are enforced on the server." actions={<Link className="btn-primary" href="/admin/roles/new">New role</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{roles.map((r) => (
        <Link key={r.id} href={`/admin/roles/${r.id}`} className="card block p-5 hover:shadow-md">
          <div className="flex items-center justify-between"><span className="font-semibold">{r.name}</span>{r.isSystem ? <Badge tone="emerald">System</Badge> : !r.active ? <Badge>Inactive</Badge> : null}</div>
          <p className="mt-1 text-sm text-slate-500">{r.description}</p>
          <div className="mt-3 text-xs text-slate-500">{r.permissions.length} permissions · {r.userCount} user(s) · scope: {r.dataScope === "own" ? "own records" : "all records"}</div>
        </Link>))}</div>
    </>
  );
}
