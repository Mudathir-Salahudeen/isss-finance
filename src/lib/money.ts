/**
 * Money helpers. All amounts are integer KOBO (₦1 = 100 kobo).
 * Parsing and formatting are done on strings/integers only — never floats.
 */
export type Kobo = number;

/** Parse user input like "₦1,250,000.50", "1250000.5", "1 250 000" into kobo. Returns null if invalid. */
export function parseNaira(input: unknown): Kobo | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = input.toFixed(2); // numbers from Excel cells: format to 2dp string first
  }
  let s = String(input).trim().replace(/[₦\s,]/g, "").replace(/^NGN/i, "");
  if (s === "") return null;
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  else if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const kobo = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(kobo)) return null;
  return neg ? -kobo : kobo;
}

/** Format kobo as "₦1,250,000.50". */
export function formatNaira(kobo: Kobo | null | undefined, opts: { symbol?: string; showZeroKobo?: boolean } = {}): string {
  if (kobo === null || kobo === undefined || Number.isNaN(kobo)) return "—";
  const symbol = opts.symbol ?? "₦";
  const neg = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${symbol}${whole}.${frac}`;
}

/** Kobo → plain decimal string "1250000.50" (for CSV/Excel export). */
export function koboToDecimalString(kobo: Kobo): string {
  const neg = kobo < 0;
  const abs = Math.abs(kobo);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

export function sumKobo(values: (Kobo | null | undefined)[]): Kobo {
  let t = 0;
  for (const v of values) t += v ?? 0;
  return t;
}

/** Percentage as a one-decimal string, using integer maths. */
export function pct(part: Kobo, whole: Kobo): string {
  if (!whole) return "0.0%";
  const tenths = Math.round((part * 1000) / whole);
  return `${(tenths / 10).toFixed(1)}%`;
}
