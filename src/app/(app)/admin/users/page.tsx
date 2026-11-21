import { requirePage } from "@/server/session";
import { listUsers, listRoles } from "@/server/services/admin";
import { PageHeader, Card, DT, StatusBadge } from "@/components/ui";
import { ActionForm, Submit, ReasonAction } from "@/components/client/forms";
import { userAction } from "../actions";

export const metadata = { title: "Users" };
export default async function Users() {
  await requirePage("users.manage");
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  const roleSelect = (def?: number) => <select name="roleId" defaultValue={def} required aria-label="Role">{roles.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>;
  return (
    <>
      <PageHeader title="Users" subtitle="New users get a temporary password and must change it at first sign-in. Deactivated users are signed out immediately." />
      <Card title="Add user" className="mb-4">
        <ActionForm action={userAction} resetOnSuccess className="grid gap-3 sm:grid-cols-5">
          <input name="fullName" placeholder="Full name" required aria-label="Full name" /><input name="email" type="email" placeholder="Email" required aria-label="Email" />
          {roleSelect()}<input name="password" type="password" placeholder="Temporary password (10+ chars)" required minLength={10} aria-label="Temporary password" autoComplete="new-password" />
          <Submit>Create user</Submit>
        </ActionForm>
      </Card>
      <Card pad={false}>
        <table><thead><tr>{["Name", "Email", "Role", "Status", "Last sign-in", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}><td className="td font-medium">{u.fullName}</td><td className="td">{u.email}</td><td className="td">{u.roleName}</td><td className="td"><StatusBadge status={u.isActive ? "active" : "inactive"} /></td><td className="td text-xs"><DT d={u.lastLoginAt} /></td>
              <td className="td"><ReasonAction action={userAction} className="btn-secondary btn-sm" label="Edit" title={`Edit ${u.fullName}`} reason={false} hidden={{ id: u.id }}
                extra={<div className="mt-3 grid gap-3">
                  <input name="fullName" defaultValue={u.fullName} required aria-label="Full name" /><input name="email" type="email" defaultValue={u.email} required aria-label="Email" />
                  {roleSelect(u.roleId)}
                  <select name="isActive" defaultValue={u.isActive ? "1" : "0"} aria-label="Status"><option value="1">Active</option><option value="0">Deactivated</option></select>
                  <input name="password" type="password" placeholder="Reset password (optional)" minLength={10} aria-label="Reset password" autoComplete="new-password" />
                </div>} confirmLabel="Save" /></td></tr>))}</tbody></table>
      </Card>
    </>
  );
}
