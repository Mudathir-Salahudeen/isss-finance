import Link from "next/link";
import { requirePage } from "@/server/session";
import { listStudents, STUDENT_STATUSES } from "@/server/services/students";
import { getStructure } from "@/server/services/academics";
import { DataTable, FilterBar, SP, sp1 } from "@/components/DataTable";
import { PageHeader } from "@/components/ui";
import { can } from "@/server/actor";

export const metadata = { title: "Students" };
export default async function Students({ searchParams }: { searchParams: Promise<SP> }) {
  const a = await requirePage("students.view");
  const sp = await searchParams;
  const st = await getStructure();
  const status = sp1(sp, "status") ?? "active";
  const rows = await listStudents({ q: sp1(sp, "q"), classId: Number(sp1(sp, "classId")) || undefined, armId: Number(sp1(sp, "armId")) || undefined, status: status === "all" ? undefined : status });
  return (
    <>
      <PageHeader title="Students" subtitle="Class shown is each student's current enrolment."
        actions={<>{can(a, "students.import") && <Link className="btn-secondary" href="/imports/new?kind=students">Bulk import</Link>}{can(a, "students.create") && <Link className="btn-primary" href="/students/new">Add student</Link>}</>} />
      <FilterBar path="/students" sp={sp} fields={[
        { name: "q", label: "Search", placeholder: "Name, admission no., phone" },
        { name: "classId", label: "Class", type: "select", options: st.classes.map((c) => ({ value: c.id, label: c.name })) },
        { name: "armId", label: "Arm", type: "select", options: st.arms.map((x) => ({ value: x.id, label: `${st.classes.find((c) => c.id === x.classId)?.name} ${x.name}` })) },
        { name: "status", label: "Status", type: "select", options: [{ value: "all", label: "Any status" }, ...STUDENT_STATUSES.map((s) => ({ value: s, label: s }))] },
      ]} />
      <DataTable path="/students" sp={sp} rows={rows as unknown as Record<string, unknown>[]} exportKey="students" canExport={can(a, "reports.export")} exportParams={{ q: sp1(sp, "q"), classId: sp1(sp, "classId"), armId: sp1(sp, "armId"), status: status === "all" ? undefined : status }}
        rowHref={(r) => `/students/${r.id}`} columns={[
          { key: "admissionNo", label: "Adm. No." }, { key: "lastName", label: "Name", render: (r) => `${r.lastName}, ${r.firstName} ${r.middleName ?? ""}` },
          { key: "levelOrder", label: "Class", render: (r) => `${r.className ?? "—"} ${r.armName ?? ""}` }, { key: "sessionName", label: "Session", hideOnMobile: true },
          { key: "gender", label: "Gender", hideOnMobile: true }, { key: "guardianPhone", label: "Guardian phone", hideOnMobile: true }, { key: "status", label: "Status", type: "status" },
        ]} />
    </>
  );
}
