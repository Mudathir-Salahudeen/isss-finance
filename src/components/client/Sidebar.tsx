"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";

export function Sidebar({ groups, schoolName, badge, hasLogo }: { groups: { label: string; items: { href: string; label: string; count?: number }[] }[]; schoolName: string; badge?: string; hasLogo?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const search = useSearchParams();
  const all = groups.flatMap((g) => g.items.map((i) => i.href));
  const score = (href: string) => {
    const [h, q] = href.split("?");
    if (!(path === h || (h !== "/dashboard" && path.startsWith(h + "/")))) return -1;
    if (q) { const want = new URLSearchParams(q); for (const [k, v] of want) if (search.get(k) !== v) return -1; return h.length + 100; }
    return h.length;
  };
  const best = all.reduce((b, h) => (score(h) > score(b) ? h : b), all[0]);
  const isActive = (href: string) => href === best && score(href) >= 0;
  return (
    <>
      <button className="no-print fixed bottom-5 right-5 z-40 rounded-full bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-lg lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="sidebar">
        {open ? "Close" : "Menu"}
      </button>
      <aside id="sidebar" className={clsx("no-print fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto border-r border-slate-100 bg-white text-slate-600 transition lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="px-5 pb-4 pt-6">
          <div className="flex items-center gap-3">
            {hasLogo ? <img src="/api/logo" alt="" className="h-14 w-12 shrink-0 object-contain" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">₦</span>}
            <div><div className="text-sm font-semibold leading-tight text-slate-900">{schoolName}</div><div className="text-[11px] text-slate-400">Finance & Control</div></div>
          </div>
          {badge && <div className="mt-1 inline-block rounded bg-amber-400 px-1.5 text-[10px] font-bold uppercase text-amber-950">{badge}</div>}
        </div>
        <nav className="px-3 pb-6" aria-label="Main">
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">{g.label}</div>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={isActive(i.href) ? "page" : undefined}
                  className={clsx("flex items-center justify-between rounded-xl px-3 py-2 text-sm", isActive(i.href) ? "bg-brand-600 font-medium text-white shadow-sm" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700")}>
                  <span>{i.label}</span>
                  {!!i.count && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-amber-950">{i.count}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-slate-900/20 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
    </>
  );
}
