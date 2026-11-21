/**
 * Acceptance tests from the specification (§23 and Addendum §3), run against a real PostgreSQL test database
 * through the same service layer the web app uses (so server-side permission checks are exercised).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "@/db";
import { sql, eq } from "drizzle-orm";
import { freshDemo, actorByEmail, ctx, PASSWORD, PNG } from "./helpers";
import { Actor } from "@/server/actor";
import * as Admin from "@/server/services/admin";
import * as Auth from "@/server/services/auth";
import * as Imp from "@/server/services/imports";
import * as Fees from "@/server/services/fees";
import * as Pay from "@/server/services/payments";
import * as Rec from "@/server/services/recon";
import * as Exp from "@/server/services/expenses";
import * as PR from "@/server/services/payroll";
import * as An from "@/server/services/analytics";
import * as Prom from "@/server/services/promotion";
import * as AuditLog from "@/server/services/auditlog";
import * as Stu from "@/server/services/students";
import { chargeBalances, studentStatement } from "@/server/services/ledger";
import { toCsv, toXlsx } from "@/lib/spreadsheet";
import { feeCategories, expenseCategories, students, enrolments, schoolSettings, auditEvents, payments } from "@/db/schema";
import { todayISO } from "@/lib/dates";

let dir: Actor, fin: Actor, cashier: Actor, admin: Actor, auditor: Actor;
let C: Awaited<ReturnType<typeof ctx>>;

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(",")).join("\n"));
const outstanding = async (studentId: number) => (await chargeBalances({ studentId })).reduce((t, b) => t + b.outstanding, 0);

beforeAll(async () => {
  await freshDemo(16);
  dir = await actorByEmail("director@demo.school.ng");
  fin = await actorByEmail("finance@demo.school.ng");
  cashier = await actorByEmail("cashier@demo.school.ng");
  admin = await actorByEmail("admin@demo.school.ng");
  auditor = await actorByEmail("auditor@demo.school.ng");
  C = await ctx();
});
afterAll(async () => { await closeDb(); });

async function newStudentWithFee(adm: string, feeAmount = "50000", opts: { allowPartial?: boolean } = {}) {
  const sid = await Stu.createStudent(admin, { admissionNo: adm, firstName: "Test", lastName: adm.replace(/\W/g, ""), sessionId: C.session.id, classId: C.classes[0].id, armId: null });
  const [cat] = await db.select().from(feeCategories).where(eq(feeCategories.name, "Other Fees"));
  const feeId = await Fees.createFee(dir, { name: `Fee ${adm}`, categoryId: cat.id, amount: feeAmount, sessionId: C.session.id, termId: C.term.id, status: "active", dueDate: "2026-10-01", allowPartial: opts.allowPartial ?? true });
  await Fees.assignFee(dir, feeId, { mode: "students", studentIds: [sid] });
  const [charge] = await chargeBalances({ studentId: sid, feeId });
  return { sid, feeId, charge };
}

function payInput(sid: number, chargeId: number, amount: string, ref: string, extra: Partial<Pay.PaymentInput> = {}): Pay.PaymentInput {
  return { studentId: sid, sessionId: C.session.id, termId: C.term.id, amount, paymentDate: todayISO(), channelId: C.channel("Bank Transfer"), accountId: C.account("GTBank"),
    reference: ref, payerName: "Parent", allocations: [{ chargeId, amount }], ...extra };
}

describe("RBAC (tests 1, 2, 18)", () => {
  it("1. Director creates a custom role with granular permissions", async () => {
    const id = await Admin.saveRole(dir, null, { name: "Bursar Assistant", description: "View + record payments", permissions: ["payments.view", "payments.create", "students.view"] });
    const r = (await Admin.listRoles()).find((x) => x.id === id)!;
    expect(r.permissions.sort()).toEqual(["payments.create", "payments.view", "students.view"]);
  });
  it("2. Director creates a user and assigns the role; user can sign in", async () => {
    const role = (await Admin.listRoles()).find((r) => r.name === "Bursar Assistant")!;
    const uid = await Admin.saveUser(dir, null, { email: "assist@demo.school.ng", fullName: "Assistant", roleId: role.id, password: PASSWORD });
    const login = await Auth.login("assist@demo.school.ng", PASSWORD, "127.0.0.1", "test");
    expect(login.token).toBeTruthy();
    const a = (await Auth.actorForUser(uid))!;
    expect(a.permissions.has("payments.approve")).toBe(false);
  });
  it("18. Permissions are enforced by the server (not just hidden buttons)", async () => {
    await expect(Admin.saveRole(fin, null, { name: "X", permissions: [] })).rejects.toThrow(/Permission required/);
    await expect(Pay.approvePayment(cashier, 1)).rejects.toThrow(/payments.approve/);
    await expect(PR.listStaff(cashier)).rejects.toThrow(/payroll.view/);
    await expect(AuditLog.listAudit(fin, {})).rejects.toThrow(/audit.view/);
    await expect(Admin.saveUser(auditor, null, { email: "x@y.z", fullName: "X", roleId: 1, password: PASSWORD })).rejects.toThrow(/users.manage/);
  });
  it("deactivated users cannot sign in; login is rate limited", async () => {
    const u = (await Admin.listUsers()).find((x) => x.email === "assist@demo.school.ng")!;
    await Admin.saveUser(dir, u.id, { email: u.email, fullName: u.fullName, roleId: u.roleId, isActive: false });
    await expect(Auth.login(u.email, PASSWORD, "127.0.0.1", "t")).rejects.toThrow(/Invalid/);
    for (let i = 0; i < 5; i++) await Auth.login("nobody@x.ng", "wrong", "10.0.0.9", "t").catch(() => null);
    await expect(Auth.login("nobody@x.ng", "wrong", "10.0.0.9", "t")).rejects.toThrow(/Too many/);
  });
});

describe("Student import (test 3)", () => {
  it("3. Import Excel/CSV: map, preview, validate, import without duplicates; failed rows reported", async () => {
    const file = csv([
      ["Adm No", "Surname", "First Name", "Class", "Arm", "DOB", "Parent Phone"],
      ["IMP/001", "Okoro", "Ada", "JSS 1", "A", "12/05/2013", "08011111111"],
      ["IMP/002", "Bello", "Musa", "JSS 1", "B", "2013-01-20", "08022222222"],
      ["IMP/002", "Bello", "Musa", "JSS 1", "B", "2013-01-20", "08022222222"], // duplicate in file
      ["IMP/003", "Eze", "Chidi", "JSS 9", "", "", ""], // bad class
      ["DEMO/2020/001", "X", "Y", "JSS 1", "A", "", ""], // existing admission number
    ]);
    const st = await Imp.stageImport(admin, "students", "students.csv", file);
    expect(st.mapping).toMatchObject({ admissionNo: "Adm No", lastName: "Surname", firstName: "First Name", className: "Class", armName: "Arm", dateOfBirth: "DOB", guardianPhone: "Parent Phone" });
    const v = await Imp.validateImport(admin, st.token, st.mapping, { sessionId: C.session.id });
    expect(v.counts).toMatchObject({ total: 5, create: 2, error: 2, skip: 1 });
    await Imp.saveMappingProfile(admin, "students", "Old SMS export", st.mapping);
    const batchId = await Imp.commitImport(admin, st.token, st.mapping, { sessionId: C.session.id });
    const b = await Imp.getImportBatch(admin, batchId);
    expect(b).toMatchObject({ createdCount: 2, failedCount: 2, skippedCount: 1 });
    expect(b.rowResults!.filter((r) => r.outcome === "failed").map((r) => r.message).join(" ")).toMatch(/Duplicate admission number in file.*|Unknown class/);
    // re-import is safe: nothing new is created
    const st2 = await Imp.stageImport(admin, "students", "students.csv", file);
    const v2 = await Imp.validateImport(admin, st2.token, st2.mapping, { sessionId: C.session.id });
    expect(v2.counts.create).toBe(0);
    // updating existing via import requires a separate permission
    await expect(Imp.validateImport(admin, st2.token, st2.mapping, { sessionId: C.session.id, updateExisting: true })).rejects.toThrow(/permission/);
  });
});

describe("Fees (tests 4, 5)", () => {
  it("4–5. Director creates PTA-style custom fee; assignment creates correct charges and totals; idempotent", async () => {
    const [cat] = await db.select().from(feeCategories).where(eq(feeCategories.name, "Excursion"));
    const jss = C.classes.filter((c) => c.name.startsWith("JSS")).map((c) => c.id);
    const feeId = await Fees.createFee(dir, { name: "Zoo Excursion", categoryId: cat.id, amount: "7500", sessionId: C.session.id, termId: C.term.id, status: "active",
      classAmounts: { [String(jss[2])]: "9000" } });
    const prev = await Fees.previewAssignment(dir, feeId, { mode: "classes", classIds: jss });
    const enrolled = await db.execute(sql`SELECT e.class_id FROM enrolments e JOIN students s ON s.id = e.student_id WHERE e.session_id = ${C.session.id} AND e.class_id IN (${sql.join(jss.map((j) => sql`${j}`), sql`,`)}) AND s.status = 'active' AND e.status <> 'reversed'`);
    const expected = (enrolled.rows as { class_id: number }[]).reduce((t, r) => t + (r.class_id === jss[2] ? 900000 : 750000), 0);
    expect(prev.studentCount).toBe(enrolled.rows.length);
    expect(prev.totalAmount).toBe(expected);
    const a = await Fees.assignFee(dir, feeId, { mode: "classes", classIds: jss });
    expect(a.created).toBe(enrolled.rows.length);
    const again = await Fees.assignFee(dir, feeId, { mode: "classes", classIds: jss });
    expect(again.created).toBe(0);
    const rep = await An.feeCollectionReport(dir, { feeId });
    expect(rep.totals.expected).toBe(expected);
    await expect(Fees.createFee(fin, { name: "Nope", categoryId: cat.id, amount: "1", sessionId: C.session.id, status: "active" })).rejects.toThrow(/fees.manage/);
  });
});

describe("Payment approval workflow (tests 6–10, 19)", () => {
  it("6–7. Finance records payment → Pending; no balance, collection, account or receipt effect", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/001");
    const before = await outstanding(sid);
    const dashBefore = await An.directorDashboard(dir, { range: { from: "2026-01-01", to: todayISO() } });
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "20000", "TRF-PAY001"), { submit: true, evidence: { name: "slip.png", type: "image/png", bytes: PNG } });
    const p = await Pay.getPayment(dir, r.id);
    expect(p.payment.status).toBe("pending");
    expect(await outstanding(sid)).toBe(before);
    const [b] = await chargeBalances({ chargeIds: [charge.chargeId] });
    expect(b.pending).toBe(2000000);
    const dashAfter = await An.directorDashboard(dir, { range: { from: "2026-01-01", to: todayISO() } });
    expect(dashAfter.collections).toBe(dashBefore.collections);
    expect(dashAfter.pending.count).toBe(dashBefore.pending.count + 1);
    await expect(Pay.logReceiptPrint(fin, r.id)).rejects.toThrow(/only available after the Director approves/);
    const tx = await db.execute(sql`SELECT count(*)::int AS n FROM account_transactions WHERE source_type = 'payment' AND source_id = ${r.id}`);
    expect((tx.rows[0] as { n: number }).n).toBe(0);
  });

  it("8. Director approves: ledger updates once, reports update, receipt printable; double approval blocked", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/002");
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "50000", "TRF-PAY002"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.approvePayment(fin, r.id)).rejects.toThrow(/payments.approve/);
    const before = await An.directorDashboard(dir, { range: { from: "2026-01-01", to: todayISO() } });
    const res = await Pay.approvePayment(dir, r.id, "Seen on statement");
    expect(res.receiptNo).toMatch(/^RCT\/\d{4}\/\d{6}$/);
    expect(await outstanding(sid)).toBe(0);
    await expect(Pay.approvePayment(dir, r.id)).rejects.toThrow(/already approved/);
    const after = await An.directorDashboard(dir, { range: { from: "2026-01-01", to: todayISO() } });
    expect(after.collections - before.collections).toBe(5000000);
    const tx = await db.execute(sql`SELECT count(*)::int AS n FROM account_transactions WHERE source_type = 'payment' AND source_id = ${r.id}`);
    expect((tx.rows[0] as { n: number }).n).toBe(1);
    const p1 = await Pay.logReceiptPrint(fin, r.id);
    const p2 = await Pay.logReceiptPrint(fin, r.id);
    expect([p1.kind, p2.kind]).toEqual(["original", "reprint"]);
  });

  it("8b. Concurrent approval attempts post exactly once", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/002B");
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "50000", "TRF-PAY002B"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    const results = await Promise.allSettled([Pay.approvePayment(dir, r.id), Pay.approvePayment(dir, r.id), Pay.approvePayment(dir, r.id)]);
    expect(results.filter((x) => x.status === "fulfilled").length).toBe(1);
    const rc = await db.execute(sql`SELECT count(*)::int AS n FROM receipts WHERE payment_id = ${r.id}`);
    expect((rc.rows[0] as { n: number }).n).toBe(1);
  });

  it("9. Director rejects with mandatory reason; ledger unchanged", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/003");
    const before = await outstanding(sid);
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "10000", "TRF-PAY003"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.rejectPayment(dir, r.id, "  ")).rejects.toThrow(/reason is required/);
    await Pay.rejectPayment(dir, r.id, "Not on statement");
    expect(await outstanding(sid)).toBe(before);
    expect((await Pay.getPayment(dir, r.id)).payment.rejectionReason).toBe("Not on statement");
  });

  it("10. Duplicate reference is blocked until acknowledged, and the review is recorded", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/004", "40000");
    await Pay.createPayment(fin, payInput(sid, charge.chargeId, "10000", "DUP-REF-1"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.createPayment(fin, payInput(sid, charge.chargeId, "10000", "dup-ref-1 "), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } }))
      .rejects.toThrow(/Possible duplicate/);
    const r2 = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "10000", "dup-ref-1", { acknowledgeDuplicate: true }), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.approvePayment(dir, r2.id)).rejects.toThrow(/duplicate/i);
    await Pay.approvePayment(dir, r2.id, "Two separate transfers confirmed", { acknowledgeDuplicate: true });
    const h = (await Pay.getPayment(dir, r2.id)).history.map((x) => x.comment).join(" ");
    expect(h).toMatch(/Duplicate check reviewed/);
  });

  it("no self-approval by default; over-allocation and partial rules enforced", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/005", "30000", { allowPartial: false });
    await expect(Pay.createPayment(fin, payInput(sid, charge.chargeId, "10000", "R-5"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } })).rejects.toThrow(/does not allow part payment/);
    await expect(Pay.createPayment(fin, payInput(sid, charge.chargeId, "40000", "R-5"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } })).rejects.toThrow(/more than the amount still open/);
    const r = await Pay.createPayment(dir, payInput(sid, charge.chargeId, "30000", "R-5"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.approvePayment(dir, r.id)).rejects.toThrow(/cannot approve/);
    await expect(Pay.createPayment(fin, { ...payInput(sid, charge.chargeId, "30000", "R-6"), allocations: [{ chargeId: charge.chargeId, amount: "20000" }] }, { submit: true })).rejects.toThrow(/must equal/);
  });

  it("19. Reversal preserves the original, posts a reversing entry, voids receipt and is audited", async () => {
    const { sid, charge } = await newStudentWithFee("PAY/006");
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "50000", "TRF-PAY006"), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await Pay.approvePayment(dir, r.id);
    await expect(Pay.reversePayment(fin, r.id, "x")).rejects.toThrow(/payments.reverse/);
    await Pay.reversePayment(dir, r.id, "Bank recalled transfer");
    const p = await Pay.getPayment(dir, r.id);
    expect(p.payment.status).toBe("reversed");
    expect(p.payment.amount).toBe(5000000);
    expect(p.receipt!.voided).toBe(true);
    expect(await outstanding(sid)).toBe(5000000);
    const st = await studentStatement(sid);
    expect(st.lines.map((l) => l.kind)).toEqual(expect.arrayContaining(["charge", "payment", "payment_reversal"]));
    expect(st.closing).toBe(5000000);
    const book = await db.execute(sql`SELECT kind, amount FROM account_transactions WHERE source_type = 'payment' AND source_id = ${r.id} ORDER BY id`);
    expect((book.rows as { kind: string; amount: number }[]).map((x) => x.amount)).toEqual([5000000, -5000000]);
    // direct edit of approved/reversed payment is refused by the database
    await expect(db.update(payments).set({ amount: 1 }).where(eq(payments.id, r.id))).rejects.toThrow();
    const ev = await AuditLog.listAudit(dir, { recordType: "payment", recordId: String(r.id) });
    expect(ev.map((e) => e.action)).toEqual(expect.arrayContaining(["payment_submitted", "payment_approved", "payment_reversed"]));
  });
});

describe("Reconciliation (tests 11, 12)", () => {
  it("11–12. Import statement, auto-match, see unmatched, categorise charge, lock and reopen with reason", async () => {
    const { sid, charge } = await newStudentWithFee("REC/001", "25000");
    const acc = C.account("GTBank");
    const r = await Pay.createPayment(fin, payInput(sid, charge.chargeId, "25000", "NIP-778899", { paymentDate: "2026-11-02" }), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    const { sid: sid2, charge: ch2 } = await newStudentWithFee("REC/002", "12000");
    const pend = await Pay.createPayment(fin, payInput(sid2, ch2.chargeId, "12000", "NIP-PENDING", { paymentDate: "2026-11-03" }), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await Pay.approvePayment(dir, r.id);
    const sheet = { headers: ["Trans Date", "Narration", "Reference", "Credit", "Debit", "Balance"], rows: [
      ["02/11/2026", "NIP TRF FROM PARENT", "NIP-778899", "25000", "", ""],
      ["03/11/2026", "NIP TRF PENDING", "NIP-PENDING", "12000", "", ""],
      ["05/11/2026", "SMS ALERT CHARGES", "", "", "52.50", ""],
      ["06/11/2026", "UNKNOWN DEPOSIT", "", "9999", "", ""],
    ] };
    const m = Rec.suggestStatementMapping(sheet.headers);
    const imp = await Rec.importStatement(fin, acc, "nov.csv", sheet, m);
    expect(imp.imported).toBe(4);
    const am = await Rec.autoMatch(fin, acc, { from: "2026-11-01", to: "2026-11-30" });
    expect(am.matched).toBeGreaterThanOrEqual(1);
    expect(am.evidence).toBe(1);
    // reconciliation evidence must NOT approve the pending payment
    expect((await Pay.getPayment(dir, pend.id)).payment.status).toBe("pending");
    const ws = await Rec.workspace(fin, acc, { from: "2026-11-01", to: "2026-11-30" });
    expect(ws.summary.unmatchedCredits.length).toBe(2);
    expect(ws.summary.unmatchedDebits.length).toBe(1);
    const charges = ws.lines.find((l) => String(l.description).includes("SMS"))!;
    await Rec.categoriseLine(fin, charges.id as number, "bank_charge", "Bank charges", "SMS alerts");
    // reconcile: statement balance = book balance
    const book = await (await import("@/server/services/accounts")).bookBalance(acc, "2026-11-30");
    const recId = await Rec.startReconciliation(dir, { accountId: acc, periodStart: "2026-11-01", periodEnd: "2026-11-30", statementBalance: (book / 100).toFixed(2) });
    await expect(Rec.completeReconciliation(dir, recId, "")).rejects.toThrow(/unmatched/);
    await Rec.completeReconciliation(dir, recId, "Unknown deposit under investigation; pending payment awaiting approval");
    // locked: cannot post into the period
    const { sid: sid3, charge: ch3 } = await newStudentWithFee("REC/003", "1000");
    const late = await Pay.createPayment(fin, payInput(sid3, ch3.chargeId, "1000", "LATE-1", { paymentDate: "2026-11-15" }), { submit: true, evidence: { name: "s.png", type: "image/png", bytes: PNG } });
    await expect(Pay.approvePayment(dir, late.id)).rejects.toThrow(/locked/);
    await expect(Rec.reopenReconciliation(fin, recId, "x")).rejects.toThrow(/recon.reopen/);
    await expect(Rec.reopenReconciliation(dir, recId, "")).rejects.toThrow(/reason/);
    await Rec.reopenReconciliation(dir, recId, "Late payment discovered");
    await Pay.approvePayment(dir, late.id);
    const ev = await AuditLog.listAudit(dir, { recordType: "reconciliation", recordId: String(recId) });
    expect(ev.map((e) => e.action)).toEqual(expect.arrayContaining(["reconciliation_locked", "reconciliation_reopened"]));
  });
});

describe("Expenses (tests 13, 21–24)", () => {
  it("13/21/23. Finance submits; Director approves; paid recorded separately; pending is not a cash outflow", async () => {
    const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.name, "Maintenance"));
    const r = { from: "2026-11-01", to: "2026-11-30" };
    const cashBefore = await An.cashIncomeExpenditure(r);
    const id = await Exp.createExpense(fin, { title: "Fix toilets", categoryId: cat.id, amount: "64000", dateIncurred: "2026-11-11", payeeName: "Plumber Joe", accountId: C.account("Zenith") }, { submit: true });
    const list = await Exp.listExpenses(dir, { status: "pending" });
    expect(list.find((e) => e.id === id)!.createdByName).toMatch(/Tunde/);
    expect((await An.cashIncomeExpenditure(r)).totalExpenses).toBe(cashBefore.totalExpenses);
    await expect(Exp.payExpense(fin, id, { paidDate: "2026-11-12", accountId: C.account("Zenith"), reference: "X" })).rejects.toThrow(/Only approved/);
    await Exp.approveExpense(dir, id, "ok");
    expect((await An.cashIncomeExpenditure(r)).totalExpenses).toBe(cashBefore.totalExpenses);
    expect((await An.unpaidLiabilities()).approvedUnpaidExpenses).toBeGreaterThanOrEqual(6400000);
    await Exp.payExpense(fin, id, { paidDate: "2026-11-12", accountId: C.account("Zenith"), reference: "ZEN-TOILET" });
    await expect(Exp.payExpense(fin, id, { paidDate: "2026-11-12", accountId: C.account("Zenith"), reference: "ZEN-TOILET" })).rejects.toThrow(/already/);
    expect((await An.cashIncomeExpenditure(r)).totalExpenses - cashBefore.totalExpenses).toBe(6400000);
    const tx = await db.execute(sql`SELECT count(*)::int AS n FROM account_transactions WHERE source_type = 'expense' AND source_id = ${id}`);
    expect((tx.rows[0] as { n: number }).n).toBe(1);
  });
  it("22/24. Director creates expense; identified as creator; needs second approver by policy; filter by creator", async () => {
    const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.name, "Marketing"));
    const id = await Exp.createExpense(dir, { title: "Flyers", categoryId: cat.id, amount: "30000", dateIncurred: "2026-11-15", payeeName: "Print Hub" }, { submit: true });
    await expect(Exp.approveExpense(dir, id)).rejects.toThrow(/second approver/);
    const mine = await Exp.listExpenses(dir, { entrantRole: "director" });
    expect(mine.every((e) => e.createdByDirector)).toBe(true);
    expect(mine.some((e) => e.id === id)).toBe(true);
    expect((await Exp.listExpenses(dir, { createdBy: fin.id })).every((e) => e.createdByName.includes("Tunde"))).toBe(true);
    // policy can allow self-approval explicitly — then it is recorded as self-approval
    await db.update(schoolSettings).set({ allowSelfApprovalExpenses: true });
    await Exp.approveExpense(dir, id);
    const g = await Exp.getExpense(dir, id);
    expect(g.history.some((h) => h.action === "self_approved")).toBe(true);
    await db.update(schoolSettings).set({ allowSelfApprovalExpenses: false });
  });
});

describe("Payroll (test 14)", () => {
  it("14. Payroll user creates monthly payroll; Director approves; payments tracked; locked after approval", async () => {
    const periods = await PR.listPeriods(dir);
    const nov = periods.find((p) => p.period === "2026-11")!;
    const pd = await PR.getPeriod(dir, nov.id);
    await PR.addLineItem(fin, pd.lines[0].id, { kind: "bonus", name: "Exam supervision", amount: "10000" });
    await PR.submitPayroll(fin, nov.id);
    await expect(PR.approvePayroll(fin, nov.id)).rejects.toThrow(/payroll.approve/);
    await PR.approvePayroll(dir, nov.id);
    await expect(PR.addLineItem(fin, pd.lines[0].id, { kind: "bonus", name: "x", amount: "1" })).rejects.toThrow(/cannot be edited/);
    const line = (await PR.getPeriod(dir, nov.id)).lines[0];
    await PR.paySalary(fin, line.id, { amount: (Math.floor(line.net / 2) / 100).toFixed(2), paymentDate: "2026-11-20", accountId: C.account("Zenith"), reference: "NOV-1" });
    const after = await PR.getPeriod(dir, nov.id);
    expect(after.period.status).toBe("partially_paid");
    expect(after.lines[0].status).toBe("partially_paid");
    await expect(PR.paySalary(fin, line.id, { amount: (line.net / 100).toFixed(2), paymentDate: "2026-11-20", accountId: C.account("Zenith"), reference: "NOV-2" })).rejects.toThrow(/exceeds/);
    // payroll is not double counted: salary appears once in cash P&L
    const pl = await An.cashIncomeExpenditure({ from: "2026-11-01", to: "2026-11-30" });
    expect(pl.payroll).toBe(Math.floor(line.net / 2));
    expect(pl.expenses.filter((e) => e.category.startsWith("Salaries")).length).toBe(1);
  });
});

describe("Reports & dashboard (tests 15, 16, 20)", () => {
  it("15/20. Dashboard totals agree with detailed lists for the same filters", async () => {
    const range = { from: "2026-09-01", to: todayISO() };
    const d = await An.directorDashboard(dir, { range, sessionId: C.session.id });
    const approved = await Pay.listPayments(dir, { status: "approved", from: range.from, to: range.to, sessionId: C.session.id });
    expect(d.collections).toBe(approved.reduce((t, p) => t + p.amount, 0));
    const pending = await Pay.listPayments(dir, { status: "pending" });
    expect(d.pending.total).toBe(pending.reduce((t, p) => t + p.amount, 0));
    const deb = await An.debtors(dir, { sessionId: C.session.id });
    expect(d.debtorTotals.outstanding).toBe(deb.totals.outstanding);
    expect(d.fees.outstanding).toBeGreaterThanOrEqual(deb.totals.outstanding);
    const pl = await An.profitAndLoss(dir, range);
    expect(pl.cash.surplus).toBe(pl.cash.totalIncome - pl.cash.totalExpenses);
    const book = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM account_transactions WHERE kind IN ('fee_payment','fee_payment_reversal') AND txn_date BETWEEN ${range.from} AND ${range.to}`);
    expect(pl.cash.income.filter((i) => i.group === "Fees").reduce((t, i) => t + i.amount, 0)).toBe(Number((book.rows[0] as { s: number }).s));
  });
  it("16. Debtors list filters and exports; statement of account", async () => {
    const jss1 = C.classes.find((c) => c.name === "JSS 1")!;
    const deb = await An.debtors(dir, { sessionId: C.session.id, classId: jss1.id });
    expect(deb.list.every((x) => x.className === "JSS 1" && x.outstanding > 0)).toBe(true);
    const csvOut = toCsv([{ key: "admissionNo", label: "Adm" }, { key: "outstanding", label: "Outstanding", type: "money" }], deb.list as unknown as Record<string, unknown>[]);
    expect(csvOut.split("\r\n").length).toBe(deb.list.length + 1);
    const x = await toXlsx("Debtors", [{ key: "admissionNo", label: "Adm" }], deb.list as unknown as Record<string, unknown>[]);
    expect(x.subarray(0, 2).toString()).toBe("PK");
    const st = await studentStatement(deb.list[0].studentId);
    expect(st.closing).toBe(deb.list[0].outstanding);
    await expect(An.debtors(cashier, {})).rejects.toThrow(/debtors.view/);
  });
  it("17. Audit log is searchable, append-only, and exports are logged", async () => {
    const ev = await AuditLog.listAudit(dir, { module: "payments", action: "approved" });
    expect(ev.length).toBeGreaterThan(0);
    const cause = (p: Promise<unknown>) => p.then(() => "no error", (e: { cause?: { message?: string } }) => String(e.cause?.message));
    expect(await cause(db.update(auditEvents).set({ action: "tampered" }).where(eq(auditEvents.id, ev[0].id)))).toMatch(/append-only/);
    expect(await cause(db.delete(auditEvents).where(eq(auditEvents.id, ev[0].id)))).toMatch(/append-only/);
    await AuditLog.logExport(dir, "audit", "csv", ev.length, {}, true);
    await expect(AuditLog.logExport(fin, "payroll", "csv", 1, {}, true)).rejects.toThrow(/export_sensitive/);
    expect((await AuditLog.listAudit(dir, { action: "export" })).length).toBeGreaterThan(0);
  });
});

describe("Promotion (tests 25–29)", () => {
  let nextSession: number;
  it("25. Preview, change an individual decision, confirm bulk promotion", async () => {
    const { saveSession } = await import("@/server/services/academics");
    nextSession = await saveSession(dir, null, { name: "2027/2028", isCurrent: false });
    const jss1 = C.classes.find((c) => c.name === "JSS 1")!;
    const pv = await Prom.previewPromotion(admin, C.session.id, nextSession, jss1.id);
    expect(pv.rows.length).toBeGreaterThan(2);
    expect(pv.rows.filter((r) => r.proposedAction === "promote").every((r) => r.toClassName === "JSS 2")).toBe(true);
    const decisions = pv.rows.filter((r) => r.proposedAction === "promote").map((r, i) => i === 0 ? { studentId: r.studentId, action: "repeat" as const } :
      i === 1 ? { studentId: r.studentId, action: "transfer" as const, reason: "Relocated to Abuja" } : { studentId: r.studentId, action: "promote" as const, toClassId: r.toClassId, toArmId: r.toArmId });
    // destination outside the structure is refused
    const bad = await Prom.executePromotion(admin, { fromSessionId: C.session.id, toSessionId: nextSession, decisions: [{ studentId: decisions[2].studentId, action: "promote", toClassId: 99999 }] });
    expect(bad.results[0].ok).toBe(false);
    const res = await Prom.executePromotion(admin, { fromSessionId: C.session.id, toSessionId: nextSession, decisions });
    expect(res.failed).toBe(0);
    (globalThis as Record<string, unknown>).__dec = decisions;
  });
  it("26–27. Current class updated; prior-session charges/payments untouched; repeater stays with new enrolment", async () => {
    const decisions = (globalThis as Record<string, unknown>).__dec as Prom.Decision[];
    const promoted = decisions[2].studentId;
    const repeater = decisions[0].studentId;
    const before = await chargeBalances({ studentId: promoted, sessionId: C.session.id });
    const g = await Stu.getStudent(promoted);
    expect(g.current!.className).toBe("JSS 2");
    expect(g.enrolments.length).toBe(2);
    expect(g.enrolments.find((e) => e.sessionId === C.session.id)!.className).toBe("JSS 1");
    const after = await chargeBalances({ studentId: promoted, sessionId: C.session.id });
    expect(after).toEqual(before);
    expect(after.every((c) => c.className === "JSS 1")).toBe(true);
    const r = await Stu.getStudent(repeater);
    expect(r.current!.className).toBe("JSS 1");
    expect(r.enrolments.filter((e) => e.className === "JSS 1").length).toBe(2);
    expect(r.current!.entryType).toBe("repeated");
  });
  it("28. Transferred student is searchable with history and excluded from active fee assignment", async () => {
    const decisions = (globalThis as Record<string, unknown>).__dec as Prom.Decision[];
    const t = decisions[1].studentId;
    const [s] = await db.select().from(students).where(eq(students.id, t));
    expect(s.status).toBe("transferred");
    expect((await Stu.listStudents({ q: s.admissionNo })).length).toBe(1);
    expect((await chargeBalances({ studentId: t })).length).toBeGreaterThan(0);
    const [cat] = await db.select().from(feeCategories).where(eq(feeCategories.name, "Other Fees"));
    const fee = await Fees.createFee(dir, { name: "Late fee test", categoryId: cat.id, amount: "100", sessionId: C.session.id, status: "active" });
    const pv = await Fees.previewAssignment(dir, fee, { mode: "all" });
    expect(pv.students.some((x) => x.studentId === t)).toBe(false);
    expect(pv.skipped.some((x) => x.studentId === t && /transferred/.test(x.reason))).toBe(true);
  });
  it("29. Duplicate promotion into the same session is prevented; actor recorded; reversal audited", async () => {
    const decisions = (globalThis as Record<string, unknown>).__dec as Prom.Decision[];
    const again = await Prom.executePromotion(admin, { fromSessionId: C.session.id, toSessionId: nextSession, decisions: [decisions[2]] });
    expect(again.results[0].ok).toBe(false);
    expect(again.results[0].message).toMatch(/duplicate prevented/);
    const live = await db.select().from(enrolments).where(eq(enrolments.studentId, decisions[2].studentId));
    expect(live.filter((e) => e.sessionId === nextSession && e.status !== "reversed").length).toBe(1);
    const hist = await Prom.promotionHistory({ studentId: decisions[2].studentId });
    expect(hist[0].performed_by_name).toMatch(/Emeka/);
    await expect(Prom.reversePromotion(admin, hist[0].id as number, "x")).rejects.toThrow(/promote_reverse/);
    await Prom.reversePromotion(dir, hist[0].id as number, "Promoted in error");
    expect((await Stu.getStudent(decisions[2].studentId)).current!.className).toBe("JSS 1");
    expect((await Prom.promotionHistory({ studentId: decisions[2].studentId }))[0].reversed_at).toBeTruthy();
  });
});
