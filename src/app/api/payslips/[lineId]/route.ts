import { withActor, fileResponse } from "@/server/http";
import { requirePerm } from "@/server/actor";
import { getPeriod } from "@/server/services/payroll";
import { getSettings } from "@/server/services/admin";
import { payslipPdf } from "@/server/pdf";
import { audit } from "@/server/audit";
import { db } from "@/db";
import { payrollLines } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError, NotFoundError } from "@/lib/errors";

export const GET = withActor<{ params: Promise<{ lineId: string }> }>(async (actor, _req, { params }) => {
  requirePerm(actor, "payroll.view");
  const lineId = Number((await params).lineId);
  const [l] = await db.select().from(payrollLines).where(eq(payrollLines.id, lineId));
  if (!l) throw new NotFoundError("Payroll line");
  const p = await getPeriod(actor, l.periodId);
  if (!["approved", "partially_paid", "paid"].includes(p.period.status)) throw new AppError("Payslips are available once the payroll is approved.", 403);
  const line = p.lines.find((x) => x.id === lineId)!;
  await audit(db, actor, { action: "payslip_printed", module: "payroll", recordType: "payroll_line", recordId: lineId });
  const pdf = await payslipPdf(await getSettings(), {
    period: p.period.name, status: p.period.status, staff: { name: line.fullName, staffNo: line.staffNo, department: line.department, position: line.position, bank: line.bankName, account: line.bankAccountNumber },
    basic: line.basic, items: p.items.filter((i) => i.lineId === lineId).map((i) => ({ kind: i.kind, name: i.name, amount: i.amount })), gross: line.gross, net: line.net, paid: line.paidAmount, printedBy: actor.fullName,
  });
  return fileResponse(pdf, `payslip-${p.period.period}-${line.staffNo}.pdf`, "application/pdf", true);
});
