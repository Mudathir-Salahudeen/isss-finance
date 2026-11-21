import { requirePage } from "@/server/session";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { passwordAction } from "../admin/actions";

export default async function Account() {
  const a = await requirePage();
  return (
    <>
      <PageHeader title="My account" subtitle={`${a.fullName} · ${a.email} · ${a.roleName}`} />
      <Card title="Change password" className="max-w-md">
        <ActionForm action={passwordAction} resetOnSuccess className="space-y-3">
          <Field label="Current password" name="current"><input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password" name="next" hint="At least 10 characters with letters and numbers"><input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} /></Field>
          <Field label="Confirm new password" name="confirm"><input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
          <Submit>Change password</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
