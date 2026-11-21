import { requirePage } from "@/server/session";
import { getStructure } from "@/server/services/academics";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { ClassArmSelect } from "@/components/client/ClassArmSelect";
import { StudentFields } from "@/components/StudentFields";
import { createStudentAction } from "../actions";

export default async function NewStudent() {
  await requirePage("students.create");
  const st = await getStructure();
  const cur = st.sessions.find((s) => s.isCurrent);
  return (
    <>
      <PageHeader title="Add student" back={{ href: "/students", label: "Students" }} />
      <Card>
        <ActionForm action={createStudentAction} className="space-y-5">
          <StudentFields />
          <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <Field label="Academic session" name="sessionId" required>
              <select id="sessionId" name="sessionId" defaultValue={cur?.id} required>{st.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Field>
            <ClassArmSelect classes={st.classes.filter((c) => c.active)} arms={st.arms.filter((a) => a.active)} />
          </div>
          <Submit>Save student</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
