import { withActor, fileResponse, searchParamsOf } from "@/server/http";
import { runReport, describeFilters } from "@/server/reports";
import { logExport } from "@/server/services/auditlog";
import { getSettings } from "@/server/services/admin";
import { toCsv, toXlsx } from "@/lib/spreadsheet";
import { tablePdf } from "@/server/pdf";
import { AppError } from "@/lib/errors";

export const GET = withActor<{ params: Promise<{ report: string }> }>(async (actor, req, { params }) => {
  const { report } = await params;
  const p = searchParamsOf(req);
  const format = p.format ?? "csv";
  const r = await runReport(actor, report, p);
  if (!r.canExport) throw new AppError(r.def.sensitive ? "Exporting this sensitive report requires the 'Export sensitive data' permission." : "You do not have permission to export reports.", 403);
  await logExport(actor, report, format, r.rows.length, p, !!r.def.sensitive);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${report}-${stamp}`;
  const rows = r.totals ? [...r.rows, r.totals] : r.rows;
  const s = await getSettings();
  const meta = [s.schoolName + (s.isDemoData ? " — DEMO DATA" : ""), r.def.title, `Exported ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} by ${actor.fullName}`, ...(r.meta ?? []), ...describeFilters(p)];
  if (format === "xlsx") return fileResponse(await toXlsx(r.def.title, r.columns, rows, meta), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (format === "pdf") return fileResponse(await tablePdf(s, { title: r.def.title, meta: [...(r.meta ?? []), ...describeFilters(p)], columns: r.columns, rows: r.rows, totals: r.totals, generatedBy: actor.fullName }), `${name}.pdf`, "application/pdf", true);
  return fileResponse(Buffer.from(toCsv(r.columns, rows)), `${name}.csv`, "text/csv; charset=utf-8");
});
