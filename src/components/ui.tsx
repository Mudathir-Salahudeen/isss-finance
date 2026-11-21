import Link from "next/link";
import { formatNaira } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { clsx } from "clsx";
import React from "react";

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back.href} className="no-print mb-1 inline-block text-xs text-slate-500 hover:text-brand-600">← {back.label}</Link>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "px-5 pb-5 pt-2" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default", href, basis }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "good" | "warn" | "bad"; href?: string; basis?: string }) {
  const inner = (
    <div className={clsx("card h-full p-5", href && "transition hover:border-brand-100 hover:shadow-md")}>
      <div className={clsx("text-2xl font-semibold tabular-nums tracking-tight", { "text-brand-700": tone === "good", "text-amber-600": tone === "warn", "text-rose-600": tone === "bad", "text-slate-900": tone === "default" })}>{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      {basis && <div className="mt-2 text-[11px] leading-tight text-slate-400">{basis}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "bg-slate-100 text-slate-700"],
  pending: ["Pending approval", "bg-amber-100 text-amber-800"],
  pending_approval: ["Pending approval", "bg-amber-100 text-amber-800"],
  approved: ["Approved", "bg-brand-50 text-brand-700"],
  rejected: ["Rejected", "bg-rose-100 text-rose-800"],
  reversed: ["Reversed", "bg-purple-100 text-purple-800"],
  cancelled: ["Cancelled", "bg-slate-200 text-slate-600"],
  paid: ["Paid", "bg-emerald-100 text-emerald-800"],
  partially_paid: ["Partially paid", "bg-sky-100 text-sky-800"],
  partial: ["Partial", "bg-sky-100 text-sky-800"],
  unpaid: ["Unpaid", "bg-rose-100 text-rose-800"],
  overpaid: ["Credit", "bg-indigo-100 text-indigo-800"],
  reconciled: ["Reconciled", "bg-emerald-100 text-emerald-800"],
  in_progress: ["In progress", "bg-sky-100 text-sky-800"],
  reopened: ["Reopened", "bg-amber-100 text-amber-800"],
  matched: ["Matched", "bg-emerald-100 text-emerald-800"],
  unmatched: ["Unmatched", "bg-rose-100 text-rose-800"],
  categorised: ["Recorded", "bg-emerald-100 text-emerald-800"],
  ignored: ["Ignored", "bg-slate-200 text-slate-600"],
  duplicate: ["Duplicate", "bg-amber-100 text-amber-800"],
  active: ["Active", "bg-emerald-100 text-emerald-800"],
  inactive: ["Inactive", "bg-slate-200 text-slate-600"],
  graduated: ["Graduated", "bg-indigo-100 text-indigo-800"],
  withdrawn: ["Withdrawn", "bg-slate-200 text-slate-700"],
  transferred: ["Transferred", "bg-slate-200 text-slate-700"],
  suspended: ["Suspended", "bg-amber-100 text-amber-800"],
  archived: ["Archived", "bg-slate-200 text-slate-600"],
  posted: ["Posted", "bg-emerald-100 text-emerald-800"],
  completed: ["Completed", "bg-emerald-100 text-emerald-800"],
  completed_with_errors: ["Completed with errors", "bg-amber-100 text-amber-800"],
  promoted: ["Promoted", "bg-emerald-100 text-emerald-800"],
  repeated: ["Repeated", "bg-amber-100 text-amber-800"],
  on_leave: ["On leave", "bg-sky-100 text-sky-800"],
  exited: ["Exited", "bg-slate-200 text-slate-600"],
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const [label, cls] = STATUS[status] ?? [status.replace(/_/g, " "), "bg-slate-100 text-slate-700"];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "amber" | "rose" | "emerald" | "sky" | "indigo" }) {
  const t = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-100 text-amber-800", rose: "bg-rose-100 text-rose-800", emerald: "bg-emerald-100 text-emerald-800", sky: "bg-sky-100 text-sky-800", indigo: "bg-indigo-100 text-indigo-800" }[tone];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export const N = ({ k, className }: { k: number | null | undefined; className?: string }) => <span className={clsx("tabular-nums whitespace-nowrap", (k ?? 0) < 0 && "text-rose-700", className)}>{formatNaira(k)}</span>;
export const D = ({ d, fmt }: { d: string | null | undefined; fmt?: string }) => <span className="whitespace-nowrap">{formatDate(d, fmt)}</span>;
export const DT = ({ d }: { d: Date | string | null | undefined }) => <span className="whitespace-nowrap">{formatDateTime(d)}</span>;

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "success"; title?: string; children?: React.ReactNode }) {
  const c = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", error: "border-rose-200 bg-rose-50 text-rose-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={clsx("rounded-md border px-3 py-2 text-sm", c)}>
      {title && <div className="font-semibold">{title}</div>}
      {children}
    </div>
  );
}

export function Empty({ children = "Nothing to show yet." }: { children?: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function DL({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: number }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-3 text-sm", cols === 3 ? "sm:grid-cols-3" : cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-800">{v ?? "—"}</dd></div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <div className="no-print mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={clsx("-mb-px border-b-2 px-3 py-2 text-sm", t.key === current ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.label}{t.count !== undefined && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, name, error, hint, children, required, className }: { label: string; name?: string; error?: string; hint?: string; children: React.ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block">{label}{required && <span className="text-rose-600"> *</span>}</label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Pct({ tenths }: { tenths: number }) {
  return <span className="tabular-nums">{(tenths / 10).toFixed(1)}%</span>;
}

export function Bar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "rose" | "emerald" }) {
  const w = max > 0 ? Math.max(2, Math.min(100, Math.round((value * 100) / max))) : 0;
  return <div className="h-2 w-full rounded bg-slate-100"><div className={clsx("h-2 rounded", { "bg-brand-500": tone === "brand", "bg-rose-500": tone === "rose", "bg-emerald-500": tone === "emerald" })} style={{ width: `${w}%` }} /></div>;
}
