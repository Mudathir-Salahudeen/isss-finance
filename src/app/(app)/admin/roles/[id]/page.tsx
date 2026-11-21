import { requirePage } from "@/server/session";
import { listRoles } from "@/server/services/admin";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { PageHeader, Card, Field, Alert } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { roleAction } from "../../actions";
import { notFound } from "next/navigation";

export default async function RoleEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await requirePage("roles.manage");
  const idp = (await params).id;
  const role = idp === "new" ? null : (await listRoles()).find((r) => r.id === Number(idp));
  if (idp !== "new" && !role) notFound();
  const has = new Set(role?.permissions ?? []);
  return (
    <>
      <PageHeader title={role ? `Role: ${role.name}` : "New role"} back={{ href: "/admin/roles", label: "Roles" }} />
      {(await searchParams).saved && <div className="mb-4"><Alert tone="success">Role saved. Changes apply to users on their next page load.</Alert></div>}
      {role?.isSystem && <div className="mb-4"><Alert tone="info">The Director system role always keeps every permission so the school can never be locked out.</Alert></div>}
      <ActionForm action={roleAction} className="space-y-4">
        {role && <input type="hidden" name="id" value={role.id} />}
        <Card><div className="grid gap-4 sm:grid-cols-4">
          <Field label="Role name" name="name" required><input id="name" name="name" defaultValue={role?.name} required /></Field>
          <Field label="Description" name="description" className="sm:col-span-2"><input id="description" name="description" defaultValue={role?.description ?? ""} /></Field>
          <Field label="Data scope" name="dataScope" hint="'Own' limits payments/expenses lists to records the user entered"><select id="dataScope" name="dataScope" defaultValue={role?.dataScope ?? "all"}><option value="all">All records</option><option value="own">Own records only</option></select></Field>
          <Field label="Status" name="active"><select id="active" name="active" defaultValue={role?.active === false ? "0" : "1"}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
        </div></Card>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{PERMISSION_GROUPS.map((g) => (
          <Card key={g.module} title={g.module}>
            <div className="space-y-1.5">{g.perms.map(([k, l]) => <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name="perm" value={k} defaultChecked={has.has(k)} disabled={role?.isSystem} className="mt-0.5" /><span>{l}<span className="block text-[11px] text-slate-400">{k}</span></span></label>)}</div>
          </Card>))}</div>
        <Submit>Save role</Submit>
      </ActionForm>
    </>
  );
}
