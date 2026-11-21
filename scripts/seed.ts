/**
 * DEVELOPMENT DEMO DATA ONLY. Refuses to run when NODE_ENV=production.
 * Wipes the database and creates a clearly-labelled demo school ("DEMO DATA" banner shown in the app).
 * All records are created through the real service layer, so they follow every workflow rule.
 * Usage: npm run db:seed   (password for every demo user comes from DEMO_PASSWORD in .env)
 */
import "dotenv/config";
import { sql, eq } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { users, roles, schoolSettings, classes, paymentChannels, accounts, feeCategories, expenseCategories } from "@/db/schema";
import { runMigrations } from "./migrate";
import { setupBase, createFirstDirector } from "@/server/setup";
import { actorForUser, hashPassword } from "@/server/services/auth";
import * as A from "@/server/services/academics";
import * as S from "@/server/services/students";
import * as F from "@/server/services/fees";
import * as P from "@/server/services/payments";
import * as AC from "@/server/services/accounts";
import * as E from "@/server/services/expenses";
import * as PR from "@/server/services/payroll";
import { chargeBalances } from "@/server/services/ledger";
import { Actor } from "@/server/actor";

export async function resetDatabase() {
  await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await runMigrations(process.env.DATABASE_URL!);
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

export async function seedDemo(opts: { students?: number; password?: string } = {}) {
  const password = opts.password ?? process.env.DEMO_PASSWORD;
  if (!password) throw new Error("Set DEMO_PASSWORD in .env (min 10 chars, letters and digits).");
  await setupBase();
  await createFirstDirector("director@demo.school.ng", "Mrs. Adaeze Nwosu (Director)", password);
  const dir = (await actorForUser((await db.select().from(users))[0].id))!;
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, dir.id));
  await db.update(schoolSettings).set({ schoolName: "IBN Salahudeen Science School (ISSS)", address: "", phone: "", email: "", isDemoData: true }).where(eq(schoolSettings.id, 1));

  const roleId = async (name: string) => (await db.select().from(roles).where(eq(roles.name, name)))[0].id;
  const mk = async (email: string, fullName: string, role: string) => {
    const [u] = await db.insert(users).values({ email, fullName, roleId: await roleId(role), passwordHash: await hashPassword(password) }).returning();
    return (await actorForUser(u.id))!;
  };
  const fin = await mk("finance@demo.school.ng", "Mr. Tunde Bakare (Accountant)", "Finance / Accountant");
  const cashier = await mk("cashier@demo.school.ng", "Miss Halima Yusuf (Cashier)", "Cashier");
  const admin = await mk("admin@demo.school.ng", "Mr. Emeka Obi (School Admin)", "School Administrator");
  await mk("auditor@demo.school.ng", "Mrs. Folake Adeyemi (Auditor)", "Auditor");

  // Academic structure
  const s1 = await A.saveSession(dir, null, { name: "2025/2026", startDate: "2025-09-08", endDate: "2026-07-24", isCurrent: false });
  const s2 = await A.saveSession(dir, null, { name: "2026/2027", startDate: "2026-09-14", endDate: "2027-07-23", isCurrent: true });
  for (const [sid, y] of [[s1, 2025], [s2, 2026]] as const) {
    await A.saveTerm(dir, null, { sessionId: sid, name: "First Term", seq: 1, startDate: `${y}-09-14`, endDate: `${y}-12-18`, isCurrent: sid === s2 });
    await A.saveTerm(dir, null, { sessionId: sid, name: "Second Term", seq: 2, startDate: `${y + 1}-01-11`, endDate: `${y + 1}-04-09`, isCurrent: false });
    await A.saveTerm(dir, null, { sessionId: sid, name: "Third Term", seq: 3, startDate: `${y + 1}-04-26`, endDate: `${y + 1}-07-23`, isCurrent: false });
  }
  const names = ["Nursery 1", "Nursery 2", "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6", "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"];
  const ids: number[] = [];
  for (let i = names.length - 1; i >= 0; i--) {
    ids[i] = await A.saveClass(dir, null, { name: names[i], levelOrder: i + 1, nextClassId: i === names.length - 1 ? null : ids[i + 1], isTerminal: i === names.length - 1 || names[i] === "Primary 6" && false, active: true });
  }
  const armIds: Record<number, number[]> = {};
  for (const cid of ids) {
    armIds[cid] = [await A.saveArm(dir, null, { classId: cid, name: "A", active: true })];
    if ((await db.select().from(classes).where(eq(classes.id, cid)))[0].name.startsWith("JSS")) armIds[cid].push(await A.saveArm(dir, null, { classId: cid, name: "B", active: true }));
  }

  // Students (current session)
  const first = ["Chiamaka", "Tobi", "Aisha", "Emeka", "Funmi", "Ibrahim", "Ngozi", "Seun", "Zainab", "Uche", "Kemi", "Musa", "Ada", "Femi", "Hauwa", "Obinna", "Bisi", "Yusuf", "Ifeoma", "Dayo"];
  const last = ["Okafor", "Adeyemi", "Bello", "Eze", "Balogun", "Abubakar", "Nwankwo", "Ogunleye", "Mohammed", "Okeke", "Adebayo", "Usman", "Obi", "Ojo", "Lawal", "Chukwu", "Afolabi", "Danjuma", "Okoro", "Akinola"];
  const nStudents = opts.students ?? 60;
  const studentIds: number[] = [];
  for (let i = 0; i < nStudents; i++) {
    const cid = ids[i % ids.length];
    const arm = armIds[cid][i % armIds[cid].length];
    studentIds.push(await S.createStudent(admin, {
      admissionNo: `DEMO/${2020 + (i % 6)}/${String(i + 1).padStart(3, "0")}`, firstName: first[i % 20], lastName: last[(i * 7) % 20], middleName: "", gender: i % 2 ? "Male" : "Female",
      dateOfBirth: `${2010 + (i % 12)}-0${1 + (i % 9)}-1${i % 9}`, guardianName: `Mr/Mrs ${last[(i * 7) % 20]}`, guardianPhone: `080${String(30000000 + i * 1371).slice(0, 8)}`, guardianEmail: "", guardianAddress: "Lagos",
      sessionId: s2, classId: cid, armId: arm,
    }));
  }

  // Accounts
  const acct = {
    gtb: await AC.saveAccount(dir, null, { name: "GTBank — School Fees", provider: "Guaranty Trust Bank", accountNumber: "0123456789", type: "bank", openingBalance: "2500000", openingDate: "2026-09-01" }),
    zen: await AC.saveAccount(dir, null, { name: "Zenith — Operations", provider: "Zenith Bank", accountNumber: "1012345678", type: "bank", openingBalance: "4200000", openingDate: "2026-09-01" }),
    cash: await AC.saveAccount(dir, null, { name: "Cash Office", type: "cash", openingBalance: "150000", openingDate: "2026-09-01", custodianUserId: cashier.id }),
    pos: await AC.saveAccount(dir, null, { name: "Moniepoint POS", provider: "Moniepoint", accountNumber: "5001234567", type: "pos", openingBalance: "0", openingDate: "2026-09-01" }),
  };

  // Fees
  const cat = async (n: string) => (await db.select().from(feeCategories).where(eq(feeCategories.name, n)))[0].id;
  const term1 = (await A.listTerms()).find((t) => t.sessionId === s2 && t.seq === 1)!.id;
  const classAmounts: Record<string, string> = {};
  ids.forEach((cid, i) => { classAmounts[String(cid)] = String(120000 + Math.floor(i / 2) * 25000); });
  const tuition = await F.createFee(dir, { name: "Tuition", categoryId: await cat("Tuition"), amount: "150000", sessionId: s2, termId: term1, dueDate: "2026-09-30", status: "active", classAmounts });
  const pta = await F.createFee(dir, { name: "PTA Levy", categoryId: await cat("PTA Levy"), amount: "10000", sessionId: s2, termId: term1, dueDate: "2026-10-15", status: "active", allowPartial: false });
  const exam = await F.createFee(dir, { name: "Examination Fee", categoryId: await cat("Examination"), amount: "15000", sessionId: s2, termId: term1, dueDate: "2026-11-30", status: "active" });
  const cultural = await F.createFee(dir, { name: "Cultural Day", categoryId: await cat("Cultural Day"), amount: "5000", sessionId: s2, termId: term1, dueDate: "2026-11-20", status: "active", mandatory: false });
  for (const f of [tuition, pta, exam]) await F.assignFee(dir, f, { mode: "all" });
  await F.assignFee(dir, cultural, { mode: "classes", classIds: ids.slice(2, 8) });

  // Payments: a spread of approved, pending, rejected
  const channels = await db.select().from(paymentChannels);
  const ch = (n: string) => channels.find((c) => c.name === n)!.id;
  let k = 0;
  for (const sid of studentIds) {
    k++;
    const bal = (await chargeBalances({ studentId: sid })).filter((b) => b.outstanding > 0);
    const tu = bal.find((b) => b.feeName === "Tuition")!;
    const pt = bal.find((b) => b.feeName === "PTA Levy");
    const mode = k % 6; // 0: nothing, 1-2: full tuition approved, 3: part approved, 4: pending, 5: rejected+part
    if (mode === 0) continue;
    const day = String(10 + (k % 18)).padStart(2, "0");
    const month = ["09", "10", "11"][k % 3];
    const date = `2026-${month}-${month === "11" ? String(1 + (k % 19)).padStart(2, "0") : day}`;
    const amt = mode <= 2 ? tu.outstanding : Math.floor(tu.outstanding / 2 / 100) * 100;
    const allocations = [{ chargeId: tu.chargeId, amount: (amt / 100).toFixed(2) }];
    let total = amt;
    if (mode === 1 && pt) { allocations.push({ chargeId: pt.chargeId, amount: (pt.outstanding / 100).toFixed(2) }); total += pt.outstanding; }
    const useCash = k % 4 === 0;
    const recorder = useCash ? cashier : fin;
    const r = await P.createPayment(recorder, {
      studentId: sid, sessionId: s2, termId: term1, amount: (total / 100).toFixed(2), paymentDate: date, channelId: ch(useCash ? "Cash" : k % 5 === 0 ? "POS" : "Bank Transfer"),
      accountId: useCash ? acct.cash : k % 5 === 0 ? acct.pos : acct.gtb, reference: useCash ? "" : `TRF${202600000 + k * 17}`, payerName: "Parent", allocations, notes: "", idempotencyKey: `seed-${k}`,
    }, { submit: true, evidence: useCash || k % 5 === 0 ? null : { name: "transfer-slip.png", type: "image/png", bytes: PNG } });
    if (mode === 4) continue;
    if (mode === 5) { await P.rejectPayment(dir, r.id, "Amount not found in bank statement — please confirm with parent."); continue; }
    await P.approvePayment(dir, r.id, "Confirmed on bank statement");
  }

  // Transfers
  await AC.createTransfer(fin, { fromAccountId: acct.cash, toAccountId: acct.gtb, amount: "100000", transferDate: "2026-10-30", reference: "DEP-1030", notes: "Cash lodged to bank" });

  // Expenses
  const ecat = async (n: string) => (await db.select().from(expenseCategories).where(eq(expenseCategories.name, n)))[0].id;
  const v1 = await E.saveVendor(fin, null, { name: "Ikeja Electric", phone: "07000225543" });
  const v2 = await E.saveVendor(fin, null, { name: "Total Energies Filling Station" });
  const v3 = await E.saveVendor(fin, null, { name: "Educational Supplies Ltd" });
  const ex = [
    { by: fin, title: "Electricity bill — September", cat: "Utilities", amt: "185000", date: "2026-09-28", vendorId: v1, recurring: true, recurrence: "monthly", flow: "paid" },
    { by: fin, title: "Electricity bill — October", cat: "Utilities", amt: "192500", date: "2026-10-28", vendorId: v1, recurring: true, recurrence: "monthly", flow: "paid" },
    { by: fin, title: "Diesel for generator", cat: "Transport / Fuel", amt: "240000", date: "2026-10-12", vendorId: v2, flow: "paid" },
    { by: fin, title: "Exercise books & chalk", cat: "Academic Materials", amt: "310000", date: "2026-11-03", vendorId: v3, flow: "approved" },
    { by: fin, title: "Roof repair — Block B", cat: "Maintenance", amt: "450000", date: "2026-11-10", payee: "Kola Builders", flow: "pending" },
    { by: dir, title: "Inter-house sports prizes", cat: "Administration", amt: "85000", date: "2026-11-12", payee: "Trophy World", flow: "pending" },
    { by: fin, title: "Security guards — October", cat: "Security", amt: "120000", date: "2026-10-31", payee: "SafeGuard Services", flow: "rejected" },
  ];
  for (const e of ex) {
    const id = await E.createExpense(e.by, { title: e.title, categoryId: await ecat(e.cat), amount: e.amt, dateIncurred: e.date, vendorId: e.vendorId ?? null, payeeName: e.payee ?? "",
      paymentMethod: "Bank Transfer", accountId: acct.zen, recurring: !!e.recurring, recurrence: e.recurrence ?? null }, { submit: true });
    if (e.flow === "pending") continue;
    if (e.flow === "rejected") { await E.rejectExpense(dir, id, "Invoice missing — resubmit with invoice."); continue; }
    await E.approveExpense(dir, id, "OK");
    if (e.flow === "paid") await E.payExpense(fin, id, { paidDate: e.date, accountId: acct.zen, reference: `ZEN-${id}-PAY` });
  }

  // Staff & payroll (October approved and paid; November draft)
  const staffDef = [["STF-001", "Adewale Johnson", "Academics", "Mathematics Teacher", "180000"], ["STF-002", "Grace Eze", "Academics", "English Teacher", "175000"],
    ["STF-003", "Ibrahim Musa", "Academics", "Science Teacher", "185000"], ["STF-004", "Joy Okon", "Admin", "Bursary Officer", "160000"],
    ["STF-005", "Peter Ade", "Support", "Driver", "90000"], ["STF-006", "Mary Danladi", "Support", "Cleaner", "65000"]];
  for (const [no, name, dept, pos, basic] of staffDef) {
    const id = await PR.saveStaff(dir, null, { staffNo: no, fullName: name, department: dept, position: pos, startDate: "2023-09-01", bankName: "GTBank", bankAccountNumber: `01${no.slice(-3)}45678`.slice(0, 10).padEnd(10, "0"), basic, effectiveFrom: "2023-09-01" });
    await PR.savePayItem(dir, null, id, { kind: "allowance", name: "Transport allowance", amount: "15000", active: true });
    await PR.savePayItem(dir, null, id, { kind: "deduction", name: "Pension (configured by school)", amount: (Number(basic) * 0.08).toFixed(0), active: true });
    if (no === "STF-005") await PR.addLoan(dir, id, { kind: "advance", principal: "30000", monthlyDeduction: "10000", reason: "Salary advance" });
  }
  // payroll prepared by Finance, approved by Director (Finance is also a payroll payer)
  const finPayroll: Actor = { ...fin, permissions: new Set([...fin.permissions, "payroll.manage_staff"]) };
  void finPayroll;
  const oct = await PR.generatePayroll(fin, "2026-10", "2026-10-28");
  await PR.submitPayroll(fin, oct);
  await PR.approvePayroll(dir, oct, "Approved");
  await PR.payAllSalaries(fin, oct, { paymentDate: "2026-10-28", accountId: acct.zen, reference: "OCT-SAL" });
  await PR.generatePayroll(fin, "2026-11", "2026-11-27");

  return { dir, fin, cashier, admin };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  if (process.env.NODE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }
  (async () => {
    await resetDatabase();
    await seedDemo();
    console.log("Demo data created. Users: director@, finance@, cashier@, admin@, auditor@demo.school.ng — password: DEMO_PASSWORD from .env");
    await closeDb();
  })().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
}

export { accounts };
