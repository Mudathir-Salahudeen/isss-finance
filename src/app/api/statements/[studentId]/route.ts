import { withActor, fileResponse, searchParamsOf } from "@/server/http";
import { requirePerm } from "@/server/actor";
import { getStudent } from "@/server/services/students";
import { studentStatement, chargeBalances } from "@/server/services/ledger";
import { getSettings } from "@/server/services/admin";
import { statementPdf } from "@/server/pdf";
import { audit } from "@/server/audit";
import { db } from "@/db";
import { academicSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const GET = withActor<{ params: Promise<{ studentId: string }> }>(async (actor, req, { params }) => {
  requirePerm(actor, "ledger.view");
  const id = Number((await params).studentId);
  const sessionId = Number(searchParamsOf(req).sessionId) || undefined;
  const g = await getStudent(id);
  const st = await studentStatement(id, { sessionId });
  const pending = (await chargeBalances({ studentId: id, sessionId })).reduce((t, b) => t + b.pending, 0);
  const ses = sessionId ? (await db.select().from(academicSessions).where(eq(academicSessions.id, sessionId)))[0]?.name : "All sessions";
  await audit(db, actor, { action: "statement_printed", module: "ledger", recordType: "student", recordId: id, newValues: { sessionId } });
  const pdf = await statementPdf(await getSettings(), {
    student: { name: `${g.student.lastName}, ${g.student.firstName} ${g.student.middleName ?? ""}`.trim(), admissionNo: g.student.admissionNo,
      className: g.current ? `${g.current.className}${g.current.armName ? " " + g.current.armName : ""} (${g.current.sessionName})` : "—", status: g.student.status, guardian: g.student.guardianName ?? "" },
    sessionLabel: ses ?? "", lines: st.lines, totals: st.totals, closing: st.closing, pending, printedBy: actor.fullName,
  });
  return fileResponse(pdf, `statement-${g.student.admissionNo.replace(/\//g, "-")}.pdf`, "application/pdf", true);
});
