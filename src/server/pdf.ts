import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs/promises";
import path from "node:path";
import { formatNaira } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { ExportColumn } from "@/lib/spreadsheet";
import { readStored } from "./files";

type Settings = { schoolName: string; address: string | null; phone: string | null; email: string | null; logoPath: string | null; dateFormat: string; receiptFooter: string | null; receiptShowApprover: boolean; isDemoData: boolean };

const NAVY = rgb(0.094, 0.541, 0.29), GREY = rgb(0.4, 0.4, 0.4), LIGHT = rgb(0.94, 0.95, 0.97), RED = rgb(0.75, 0.1, 0.1);

class Doc {
  doc!: PDFDocument; font!: PDFFont; bold!: PDFFont; page!: PDFPage; y = 0; w = 0; h = 0; m = 40;
  constructor(public landscape = false) {}
  async init() {
    this.doc = await PDFDocument.create();
    this.doc.registerFontkit(fontkit);
    const dir = path.resolve(process.cwd(), "assets/fonts");
    this.font = await this.doc.embedFont(await fs.readFile(path.join(dir, "DejaVuSans.ttf")), { subset: true });
    this.bold = await this.doc.embedFont(await fs.readFile(path.join(dir, "DejaVuSans-Bold.ttf")), { subset: true });
    this.addPage();
    return this;
  }
  addPage() {
    const [w, h] = this.landscape ? [842, 595] : [595, 842];
    this.page = this.doc.addPage([w, h]); this.w = w; this.h = h; this.y = h - this.m;
  }
  ensure(space: number, onNew?: () => void) { if (this.y - space < this.m) { this.addPage(); onNew?.(); } }
  fit(text: string, size: number, width: number, bold = false) {
    const f = bold ? this.bold : this.font;
    let t = text ?? "";
    if (f.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
    return t + "…";
  }
  text(t: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; right?: number; y?: number } = {}) {
    const f = opts.bold ? this.bold : this.font;
    const s = String(t ?? "");
    const xx = opts.right !== undefined ? opts.right - f.widthOfTextAtSize(s, size) : x;
    this.page.drawText(s, { x: xx, y: opts.y ?? this.y, size, font: f, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
  }
  wrap(t: string, size: number, width: number) {
    const words = String(t ?? "").split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const n = cur ? cur + " " + w : w; if (this.font.widthOfTextAtSize(n, size) > width && cur) { lines.push(cur); cur = w; } else cur = n; }
    if (cur) lines.push(cur);
    return lines;
  }
  line(y = this.y, color = rgb(0.8, 0.8, 0.8)) { this.page.drawLine({ start: { x: this.m, y }, end: { x: this.w - this.m, y }, thickness: 0.6, color }); }
  async header(s: Settings, title: string, subtitle?: string) {
    let x = this.m;
    if (s.logoPath) {
      try {
        const bytes = await readStored(s.logoPath);
        const img = s.logoPath.endsWith(".png") ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
        const dims = img.scaleToFit(52, 56);
        this.page.drawImage(img, { x, y: this.y - 50, width: dims.width, height: dims.height });
        x += dims.width + 10;
      } catch { /* logo optional */ }
    }
    const titleW = this.bold.widthOfTextAtSize(title, 12) + 16;
    const nameW = this.w - this.m - x - titleW;
    const nameSize = this.bold.widthOfTextAtSize(s.schoolName, 14) <= nameW ? 14 : 11;
    this.text(this.fit(s.schoolName, nameSize, nameW, true), x, nameSize, { bold: true, color: NAVY, y: this.y - 14 });
    this.text(this.fit([s.address, s.phone, s.email].filter(Boolean).join("  ·  ") || "Financial Management & Control", 8, nameW), x, 8, { color: GREY, y: this.y - 28 });
    this.text(title, 0, 12, { bold: true, right: this.w - this.m, y: this.y - 14 });
    if (subtitle) this.text(subtitle, 0, 8, { color: GREY, right: this.w - this.m, y: this.y - 28 });
    this.y -= 60;
    if (s.isDemoData) { this.text("DEMO DATA — NOT A REAL FINANCIAL RECORD", this.m, 9, { bold: true, color: RED }); this.y -= 12; }
    this.line(); this.y -= 14;
  }
  footer(note: string) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const pg = `Page ${i + 1} of ${pages.length}`;
      p.drawText(this.fit(note, 7, this.w - 2 * this.m - 60), { x: this.m, y: 20, size: 7, font: this.font, color: GREY });
      p.drawText(pg, { x: this.w - this.m - this.font.widthOfTextAtSize(pg, 7), y: 20, size: 7, font: this.font, color: GREY });
    });
  }
}

function cell(v: unknown, type: ExportColumn["type"], fmt: string) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money") return formatNaira(Number(v));
  if (type === "date") return formatDate(String(v), fmt);
  if (v instanceof Date) return formatDateTime(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export async function tablePdf(s: Settings, o: { title: string; meta: string[]; columns: ExportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null; generatedBy: string }) {
  const d = await new Doc(o.columns.length > 6).init();
  await d.header(s, o.title, `Generated ${formatDateTime(new Date())} by ${o.generatedBy}`);
  for (const m of o.meta) { d.text(m, d.m, 8, { color: GREY }); d.y -= 11; }
  d.y -= 4;
  const avail = d.w - 2 * d.m;
  const weights = o.columns.map((c) => (["description", "title", "studentName", "changes", "error"].includes(c.key) ? 2.4 : c.type === "money" ? 1.1 : c.type === "date" ? 0.8 : c.label.length > 14 ? 1.4 : 1));
  const tw = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / tw) * avail);
  const size = o.columns.length > 9 ? 6.5 : 7.5;
  const drawHead = () => {
    d.page.drawRectangle({ x: d.m, y: d.y - 4, width: avail, height: 15, color: NAVY });
    let x = d.m;
    o.columns.forEach((c, i) => {
      const t = d.fit(c.label, size, widths[i] - 4, true);
      if (c.type === "money" || c.type === "number") d.text(t, 0, size, { bold: true, color: rgb(1, 1, 1), right: x + widths[i] - 3 });
      else d.text(t, x + 3, size, { bold: true, color: rgb(1, 1, 1) });
      x += widths[i];
    });
    d.y -= 16;
  };
  drawHead();
  const draw = (r: Record<string, unknown>, bold = false, shade = false) => {
    d.ensure(14, drawHead);
    if (shade) d.page.drawRectangle({ x: d.m, y: d.y - 3, width: avail, height: 12, color: LIGHT });
    let x = d.m;
    o.columns.forEach((c, i) => {
      const t = d.fit(cell(r[c.key], c.type, s.dateFormat), size, widths[i] - 5, bold);
      if (c.type === "money" || c.type === "number") d.text(t, 0, size, { bold, right: x + widths[i] - 3 });
      else d.text(t, x + 3, size, { bold });
      x += widths[i];
    });
    d.y -= 12;
  };
  o.rows.forEach((r, i) => draw(r, false, i % 2 === 1));
  if (!o.rows.length) { d.text("No records match the selected filters.", d.m, 9, { color: GREY }); d.y -= 14; }
  if (o.totals) { d.line(d.y + 9); draw(o.totals, true); }
  d.footer(`${s.schoolName} — ${o.title} — ${o.rows.length} row(s)`);
  return Buffer.from(await d.doc.save());
}

export interface ReceiptData {
  receiptNo: string; kind: string; printNo: number; voided: boolean; status: string;
  student: { name: string; admissionNo: string; className: string | null; armName: string | null };
  session: string; term: string | null; paymentNo: string; paymentDate: string; amount: number; channel: string; account: string; reference: string; payer: string;
  allocations: { feeName: string; amount: number; outstandingAfter: number }[]; approvedBy: string | null; approvedAt: Date | null; recordedBy: string | null; printedBy: string;
}

export async function receiptPdf(s: Settings, r: ReceiptData) {
  const d = await new Doc(false).init();
  await d.header(s, "OFFICIAL RECEIPT", `Receipt No. ${r.receiptNo}`);
  if (r.voided || r.status === "reversed") { d.text("VOID — THIS PAYMENT HAS BEEN REVERSED", d.m, 14, { bold: true, color: RED }); d.y -= 22; }
  if (r.kind === "reprint") { d.text(`REPRINT (copy #${r.printNo})`, 0, 9, { bold: true, color: RED, right: d.w - d.m }); d.y -= 4; }
  const kv = (k: string, v: string, x: number, y: number) => { d.text(k, x, 8, { color: GREY, y }); d.text(v, x + 95, 9, { bold: true, y }); };
  const y0 = d.y;
  kv("Student", r.student.name, d.m, y0); kv("Receipt No.", r.receiptNo, 330, y0);
  kv("Admission No.", r.student.admissionNo, d.m, y0 - 15); kv("Payment date", formatDate(r.paymentDate, s.dateFormat), 330, y0 - 15);
  kv("Class", [r.student.className, r.student.armName].filter(Boolean).join(" ") || "—", d.m, y0 - 30); kv("Method", r.channel, 330, y0 - 30);
  kv("Session / term", `${r.session}${r.term ? " — " + r.term : ""}`, d.m, y0 - 45); kv("Received into", r.account, 330, y0 - 45);
  kv("Paid by", r.payer || "—", d.m, y0 - 60); kv("Transaction ref.", r.reference || "—", 330, y0 - 60);
  d.y = y0 - 82;
  d.page.drawRectangle({ x: d.m, y: d.y - 4, width: d.w - 2 * d.m, height: 16, color: NAVY });
  d.text("Fee item", d.m + 4, 9, { bold: true, color: rgb(1, 1, 1) });
  d.text("Amount paid", 0, 9, { bold: true, color: rgb(1, 1, 1), right: 430 });
  d.text("Balance on item", 0, 9, { bold: true, color: rgb(1, 1, 1), right: d.w - d.m - 4 });
  d.y -= 18;
  for (const a of r.allocations) {
    d.text(a.feeName, d.m + 4, 9); d.text(formatNaira(a.amount), 0, 9, { right: 430 }); d.text(formatNaira(a.outstandingAfter), 0, 9, { right: d.w - d.m - 4 });
    d.y -= 14;
  }
  d.y -= 4; d.line(d.y + 10); d.y -= 6;
  d.text("TOTAL RECEIVED", d.m + 4, 11, { bold: true }); d.text(formatNaira(r.amount), 0, 11, { bold: true, right: 430 });
  d.y -= 26;
  d.text(`Status: ${r.status === "reversed" ? "REVERSED" : "APPROVED"}`, d.m, 9, { bold: true, color: r.status === "reversed" ? RED : rgb(0.05, 0.45, 0.2) });
  d.y -= 13;
  if (s.receiptShowApprover && r.approvedBy) { d.text(`Verified and approved by ${r.approvedBy} on ${formatDateTime(r.approvedAt)}`, d.m, 8, { color: GREY }); d.y -= 11; }
  d.text(`Recorded by ${r.recordedBy ?? "—"} · Payment ${r.paymentNo}`, d.m, 8, { color: GREY }); d.y -= 11;
  d.text(`Printed by ${r.printedBy} ${formatDateTime(new Date())}`, d.m, 8, { color: GREY });
  d.y -= 22;
  if (s.receiptFooter) for (const l of d.wrap(s.receiptFooter, 9, d.w - 2 * d.m)) { d.text(l, d.m, 9); d.y -= 12; }
  d.footer(`Official receipt ${r.receiptNo} — valid only when generated by this system after Director approval.`);
  return Buffer.from(await d.doc.save());
}

export async function statementPdf(s: Settings, o: { student: { name: string; admissionNo: string; className: string; status: string; guardian: string }; sessionLabel: string;
  lines: { date: string; description: string; reference: string; debit: number; credit: number; balance: number }[]; totals: { debit: number; credit: number }; closing: number; pending: number; printedBy: string }) {
  const rows = o.lines.map((l) => ({ ...l, debit: l.debit || null, credit: l.credit || null }));
  return tablePdf(s, {
    title: "STATEMENT OF ACCOUNT",
    meta: [`Student: ${o.student.name}   Admission No: ${o.student.admissionNo}   Current class: ${o.student.className}   Status: ${o.student.status}`,
      `Parent/guardian: ${o.student.guardian || "—"}   Period: ${o.sessionLabel}`,
      `Closing balance: ${formatNaira(o.closing)}${o.closing < 0 ? " (credit)" : ""}${o.pending ? `   ·   Payments awaiting approval (not yet credited): ${formatNaira(o.pending)}` : ""}`],
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "description", label: "Description" }, { key: "reference", label: "Receipt / ref." },
      { key: "debit", label: "Charges", type: "money" }, { key: "credit", label: "Payments / credits", type: "money" }, { key: "balance", label: "Balance", type: "money" }],
    rows, totals: { date: "", description: "TOTAL", reference: "", debit: o.totals.debit, credit: o.totals.credit, balance: o.closing }, generatedBy: o.printedBy,
  });
}

export async function payslipPdf(s: Settings, o: { period: string; status: string; staff: { name: string; staffNo: string; department: string; position: string; bank: string; account: string };
  basic: number; items: { kind: string; name: string; amount: number }[]; gross: number; net: number; paid: number; printedBy: string }) {
  const d = await new Doc(false).init();
  await d.header(s, "PAYSLIP", o.period);
  const kv = (k: string, v: string, x: number) => { d.text(k, x, 8, { color: GREY }); d.text(v, x + 80, 9, { bold: true }); };
  kv("Staff", o.staff.name, d.m); kv("Staff ID", o.staff.staffNo, 330); d.y -= 15;
  kv("Department", o.staff.department || "—", d.m); kv("Position", o.staff.position || "—", 330); d.y -= 15;
  kv("Bank", o.staff.bank || "—", d.m); kv("Account", o.staff.account ? `••••••${o.staff.account.slice(-4)}` : "—", 330); d.y -= 28;
  const section = (title: string, rows: { name: string; amount: number }[], total: number) => {
    d.page.drawRectangle({ x: d.m, y: d.y - 4, width: d.w - 2 * d.m, height: 15, color: NAVY });
    d.text(title, d.m + 4, 9, { bold: true, color: rgb(1, 1, 1) }); d.text("Amount", 0, 9, { bold: true, color: rgb(1, 1, 1), right: d.w - d.m - 4 });
    d.y -= 17;
    for (const r of rows) { d.text(r.name, d.m + 4, 9); d.text(formatNaira(r.amount), 0, 9, { right: d.w - d.m - 4 }); d.y -= 13; }
    d.line(d.y + 8); d.text(`Total ${title.toLowerCase()}`, d.m + 4, 9, { bold: true }); d.text(formatNaira(total), 0, 9, { bold: true, right: d.w - d.m - 4 }); d.y -= 22;
  };
  const earn = [{ name: "Basic salary", amount: o.basic }, ...o.items.filter((i) => ["allowance", "bonus", "arrears"].includes(i.kind))];
  const ded = o.items.filter((i) => ["deduction", "loan"].includes(i.kind));
  section("EARNINGS", earn, o.gross);
  section("DEDUCTIONS", ded, ded.reduce((t, x) => t + x.amount, 0));
  d.page.drawRectangle({ x: d.m, y: d.y - 6, width: d.w - 2 * d.m, height: 22, color: LIGHT });
  d.text("NET PAY", d.m + 6, 12, { bold: true }); d.text(formatNaira(o.net), 0, 12, { bold: true, right: d.w - d.m - 6 });
  d.y -= 30;
  d.text(`Payroll status: ${o.status.replace("_", " ")} · Paid to date: ${formatNaira(o.paid)} · Outstanding: ${formatNaira(o.net - o.paid)}`, d.m, 8, { color: GREY });
  d.footer(`${s.schoolName} — Confidential payslip. Printed by ${o.printedBy}.`);
  return Buffer.from(await d.doc.save());
}
