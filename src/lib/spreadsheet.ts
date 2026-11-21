import ExcelJS from "exceljs";
import { ValidationError } from "./errors";

export interface Sheet { headers: string[]; rows: (string | number | null)[][] }

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    return String(v);
  }
  return v as string | number;
}

export async function readSpreadsheet(buf: Buffer, fileName: string): Promise<Sheet> {
  const lower = fileName.toLowerCase();
  let grid: (string | number | null)[][];
  if (lower.endsWith(".csv")) {
    grid = parseCsv(buf.toString("utf8"));
  } else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new ValidationError("Could not read the Excel file. Save it as .xlsx or .csv and try again."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new ValidationError("The workbook has no sheets.");
    grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: (string | number | null)[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value));
      grid.push(vals);
    });
  } else {
    throw new ValidationError("Only .xlsx and .csv files are supported.");
  }
  if (!grid.length) throw new ValidationError("The file is empty.");
  const headers = grid[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const rows = grid.slice(1).map((r) => headers.map((_, i) => (r[i] === undefined ? null : r[i])))
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
  return { headers, rows };
}

export interface ExportColumn { key: string; label: string; type?: "money" | "date" | "text" | "number" | "percent" }

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: ExportColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvEscape(c.label)).join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => {
      const v = r[c.key];
      if (c.type === "money" && typeof v === "number") return (v / 100).toFixed(2); // display conversion of an exact integer
      return csvEscape(v);
    }).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

export async function toXlsx(title: string, columns: ExportColumn[], rows: Record<string, unknown>[], meta: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "School Financial Management System";
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  let r = 1;
  for (const m of meta) { ws.getCell(r, 1).value = m; ws.getCell(r, 1).font = { italic: true, color: { argb: "FF555555" } }; r++; }
  if (meta.length) r++;
  const headerRow = ws.getRow(r);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  });
  for (const row of rows) {
    r++;
    const xr = ws.getRow(r);
    columns.forEach((c, i) => {
      const v = row[c.key];
      const cell = xr.getCell(i + 1);
      if (c.type === "money" && typeof v === "number") { cell.value = v / 100; cell.numFmt = '"₦"#,##0.00;[Red]-"₦"#,##0.00'; }
      else cell.value = (v ?? "") as ExcelJS.CellValue;
    });
  }
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.min(45, Math.max(12, c.label.length + 4, ...rows.slice(0, 200).map((x) => String(x[c.key] ?? "").length + 2)));
  });
  ws.views = [{ state: "frozen", ySplit: r - rows.length }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
