import Link from "next/link";
import React from "react";
import { clsx } from "clsx";
import { formatNaira } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Empty, StatusBadge } from "./ui";

export type SP = Record<string, string | string[] | undefined>;
export const sp1 = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || undefined;
export const flat = (sp: SP) => Object.fromEntries(Object.keys(sp).map((k) => [k, sp1(sp, k)])) as Record<string, string | undefined>;

export interface Col<T> {
  key: string; label: string; type?: "money" | "date" | "datetime" | "status" | "number" | "text" | "percent";
  render?: (row: T) => React.ReactNode; sortable?: boolean; className?: string; hideOnMobile?: boolean;
}

function qs(params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v !== undefined && v !== "") u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

function cmp(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export function DataTable<T extends Record<string, unknown>>({
  columns, rows, sp, path, pageSize = 25, exportKey, canExport, totals, rowHref, empty, exportParams, title, actions,
}: {
  columns: Col<T>[]; rows: T[]; sp: SP; path: string; pageSize?: number; exportKey?: string; canExport?: boolean; totals?: Partial<Record<string, React.ReactNode>> | null;
  rowHref?: (r: T) => string | null; empty?: React.ReactNode; exportParams?: Record<string, string | undefined>; title?: React.ReactNode; actions?: React.ReactNode;
}) {
  const params = flat(sp);
  const sort = params.sort, dir = params.dir === "desc" ? "desc" : "asc";
  let data = rows;
  if (sort && columns.some((c) => c.key === sort)) {
    data = [...rows].sort((a, b) => cmp(a[sort], b[sort]) * (dir === "desc" ? -1 : 1));
  }
  const pages = Math.max(1, Math.ceil(data.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = data.slice((page - 1) * pageSize, page * pageSize);
  const exp = { ...(exportParams ?? params), page: undefined, sort: undefined, dir: undefined };
  const fmt = (c: Col<T>, r: T) => {
    if (c.render) return c.render(r);
    const v = r[c.key];
    switch (c.type) {
      case "money": return <span className={clsx(Number(v) < 0 && "text-rose-700")}>{formatNaira(v as number)}</span>;
      case "date": return formatDate(v as string);
      case "datetime": return formatDateTime(v as Date);
      case "status": return <StatusBadge status={v as string} />;
      default: return v === null || v === undefined || v === "" ? <span className="text-slate-400">—</span> : String(v);
    }
  };
  const right = (c: Col<T>) => c.type === "money" || c.type === "number";
  return (
    <div className="card overflow-hidden">
      {(title || actions || (exportKey && canExport)) && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <div className="text-sm font-semibold text-slate-800">{title}<span className="ml-2 text-xs font-normal text-slate-500">{rows.length} record{rows.length === 1 ? "" : "s"}</span></div>
          <div className="flex flex-wrap gap-2">
            {actions}
            {exportKey && canExport && (["xlsx", "csv", "pdf"] as const).map((f) => (
              <a key={f} className="btn-secondary btn-sm" href={`/api/export/${exportKey}${qs(exp, { format: f })}`} target={f === "pdf" ? "_blank" : undefined} rel="noopener">
                {f === "xlsx" ? "Excel" : f.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx("th", right(c) && "text-right", c.hideOnMobile && "hidden md:table-cell")}>
                  {c.sortable === false ? c.label : (
                    <Link className="hover:text-slate-800" href={`${path}${qs(params, { sort: c.key, dir: sort === c.key && dir === "asc" ? "desc" : "asc", page: undefined })}`}>
                      {c.label}{sort === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                    </Link>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const href = rowHref?.(r);
              return (
                <tr key={String(r.id ?? i)} className={clsx("hover:bg-slate-50", href && "cursor-pointer")}>
                  {columns.map((c, ci) => (
                    <td key={c.key} className={clsx("td", right(c) && "num", c.className, c.hideOnMobile && "hidden md:table-cell")}>
                      {href && ci === 0 ? <Link href={href} className="link font-medium">{fmt(c, r)}</Link> : fmt(c, r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {totals && shown.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                {columns.map((c) => <td key={c.key} className={clsx("td", right(c) && "num", c.hideOnMobile && "hidden md:table-cell")}>{totals[c.key] ?? ""}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!rows.length && <Empty>{empty ?? "No records match the current filters."}</Empty>}
      {pages > 1 && (
        <nav className="no-print flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm" aria-label="Pagination">
          <span className="text-slate-500">Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link className="btn-secondary btn-sm" href={`${path}${qs(params, { page: String(page - 1) })}`}>Previous</Link> : <span className="btn-secondary btn-sm opacity-40">Previous</span>}
            {page < pages ? <Link className="btn-secondary btn-sm" href={`${path}${qs(params, { page: String(page + 1) })}`}>Next</Link> : <span className="btn-secondary btn-sm opacity-40">Next</span>}
          </div>
        </nav>
      )}
    </div>
  );
}

export interface FilterField { name: string; label: string; type?: "text" | "date" | "select" | "number" | "checkbox"; options?: { value: string | number; label: string }[]; placeholder?: string; width?: string }

/** GET filter form — filters live in the URL so they are shareable and reused by exports. */
export function FilterBar({ fields, sp, path, keep = [] }: { fields: FilterField[]; sp: SP; path: string; keep?: string[] }) {
  const p = flat(sp);
  return (
    <form method="get" action={path} className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50/70 p-3">
      {keep.map((k) => p[k] && <input key={k} type="hidden" name={k} value={p[k]} />)}
      {fields.map((f) => (
        <div key={f.name} className={f.width ?? (f.type === "text" ? "min-w-48 flex-1" : "w-40")}>
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 pb-1.5 text-sm"><input type="checkbox" name={f.name} value="1" defaultChecked={p[f.name] === "1"} /> {f.label}</label>
          ) : (
            <>
              <label htmlFor={`f-${f.name}`} className="mb-1 block text-xs">{f.label}</label>
              {f.type === "select" ? (
                <select id={`f-${f.name}`} name={f.name} defaultValue={p[f.name] ?? ""}>
                  <option value="">All</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={`f-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={p[f.name] ?? ""} placeholder={f.placeholder} />
              )}
            </>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">Apply</button>
        <Link className="btn-secondary" href={path + (keep.length ? "?" + keep.filter((k) => p[k]).map((k) => `${k}=${encodeURIComponent(p[k]!)}`).join("&") : "")}>Clear</Link>
      </div>
    </form>
  );
}
