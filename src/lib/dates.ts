/** Date helpers. Dates are stored as ISO strings (YYYY-MM-DD); displayed in Nigerian dd/MM/yyyy by default. */
export function todayISO(): string {
  // Africa/Lagos (UTC+1) local date
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function formatDate(iso: string | Date | null | undefined, fmt = "dd/MM/yyyy"): string {
  if (!iso) return "—";
  const s = iso instanceof Date ? new Date(iso.getTime() + 3600000).toISOString().slice(0, 10) : iso.slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return String(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return fmt.replace("dd", d).replace("MMM", months[Number(m) - 1]).replace("MM", m).replace("yyyy", y);
}

export function formatDateTime(dt: Date | string | null | undefined): string {
  if (!dt) return "—";
  const date = typeof dt === "string" ? new Date(dt) : dt;
  return date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Parse many common date inputs (ISO, dd/mm/yyyy, Excel serial, Date) into ISO yyyy-mm-dd. */
export function parseDateInput(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy (Nigerian)
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
}
