import { withActor, fileResponse } from "@/server/http";
import { templateColumns, ImportKind, IMPORT_FIELDS } from "@/server/services/imports";
import { STATEMENT_FIELDS } from "@/server/services/recon";
import { toXlsx } from "@/lib/spreadsheet";
import { NotFoundError } from "@/lib/errors";

export const GET = withActor<{ params: Promise<{ kind: string }> }>(async (_actor, _req, { params }) => {
  const { kind } = await params;
  let cols: { key: string; label: string; example: string }[];
  if (kind === "bank_statement") cols = [
    { key: "date", label: "Transaction date", example: "02/11/2026" }, { key: "description", label: "Narration", example: "NIP TRF FROM ADA OKAFOR" },
    { key: "reference", label: "Reference", example: "000013261102123456" }, { key: "credit", label: "Credit", example: "150000" }, { key: "debit", label: "Debit", example: "" }, { key: "balance", label: "Balance", example: "2650000" }];
  else if (kind in IMPORT_FIELDS) cols = templateColumns(kind as ImportKind);
  else throw new NotFoundError("Template");
  void STATEMENT_FIELDS;
  const ex = Object.fromEntries(cols.map((c) => [c.key, c.example]));
  return fileResponse(await toXlsx("Template", cols, [ex], ["Fill one row per record. Columns marked * are required. Delete the example row before importing."]), `template-${kind}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
