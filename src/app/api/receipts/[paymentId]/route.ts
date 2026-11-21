import { withActor, fileResponse } from "@/server/http";
import { logReceiptPrint, getPayment } from "@/server/services/payments";
import { getSettings } from "@/server/services/admin";
import { receiptPdf } from "@/server/pdf";

/** Official receipt PDF. Only exists for approved (or later reversed → VOID) payments. Every print is logged. */
export const GET = withActor<{ params: Promise<{ paymentId: string }> }>(async (actor, _req, { params }) => {
  const id = Number((await params).paymentId);
  const printed = await logReceiptPrint(actor, id);
  const d = await getPayment(actor, id);
  const s = await getSettings();
  const pdf = await receiptPdf(s, {
    receiptNo: printed.receipt.receiptNo, kind: printed.kind, printNo: printed.receipt.printCount, voided: printed.receipt.voided, status: d.payment.status,
    student: { name: `${d.student.lastName}, ${d.student.firstName} ${d.student.middleName ?? ""}`.trim(), admissionNo: d.student.admissionNo, className: d.enrolment?.class_name ?? null, armName: d.enrolment?.arm_name ?? null },
    session: d.session.name, term: d.term?.name ?? null, paymentNo: d.payment.paymentNo, paymentDate: d.payment.paymentDate, amount: d.payment.amount, channel: d.channel.name,
    account: d.account.name, reference: d.payment.reference ?? "", payer: d.payment.payerName ?? "",
    allocations: d.allocations.map((a) => ({ feeName: `${a.feeName}${a.termName ? " — " + a.termName : ""}`, amount: a.amount, outstandingAfter: Math.max(d.balances.find((b) => b.chargeId === a.chargeId)?.outstanding ?? 0, 0) })),
    approvedBy: d.decidedByName, approvedAt: d.payment.decidedAt, recordedBy: d.recordedByName, printedBy: actor.fullName,
  });
  return fileResponse(pdf, `${printed.receipt.receiptNo.replace(/\//g, "-")}.pdf`, "application/pdf", true);
});
