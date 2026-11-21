import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionInfo } from "@/server/session";
import { NAV } from "@/lib/nav";
import { Sidebar } from "@/components/client/Sidebar";
import { getSettings } from "@/server/services/admin";
import { unreadCount } from "@/server/services/auditlog";
import { pendingSummary } from "@/server/services/payments";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const info = await getSessionInfo();
  if (!info) redirect("/login");
  const { actor, mustChangePassword } = info;
  const [settings, unread, pending] = await Promise.all([getSettings(), unreadCount(actor), pendingSummary()]);
  const groups = NAV.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => !i.perms.length || i.perms.some((p) => actor.permissions.has(p)))
      .map((i) => ({ href: i.href, label: i.label, count: i.href === "/payments?status=pending" ? pending.count : i.href === "/notifications" ? unread : undefined })),
  })).filter((g) => g.items.length);
  return (
    <div className="min-h-screen">
      <Suspense><Sidebar groups={groups} schoolName={settings.schoolName} badge={settings.isDemoData ? "Demo data" : undefined} hasLogo={!!settings.logoPath} /></Suspense>
      <div className="lg:pl-64">
        {settings.isDemoData && (
          <div className="no-print bg-amber-50 px-4 py-1 text-center text-xs font-medium text-amber-800">
            DEMO DATA — sample records for testing only. These are not real school finances.
          </div>
        )}
        <header className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <span className="flex items-center gap-2 font-semibold text-slate-900 sm:hidden">{settings.logoPath ? <img src="/api/logo" alt="" className="h-8 w-7 object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-xs text-white">₦</span>}ISSS Finance</span>
          <form action="/search" className="hidden flex-1 sm:block">
            <label htmlFor="global-search" className="sr-only">Search</label>
            <input id="global-search" name="q" type="search" placeholder="Search student, admission no., payment ref., receipt no., staff, expense…" className="max-w-md rounded-full bg-slate-50" />
          </form>
          <Link href="/search" className="ml-auto rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 sm:hidden" aria-label="Search"><svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></Link>
          <Link href="/notifications" className="relative rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
          </Link>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm hover:bg-slate-100">
              <span className="hidden font-medium sm:inline">{actor.fullName}</span><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 sm:hidden">{actor.fullName.replace(/^(Mr|Mrs|Miss|Ms|Dr)\.?\s+/, "").split(" ").slice(0, 2).map((x) => x[0]).join("")}</span> <span className="hidden text-xs text-slate-500 sm:inline">· {actor.roleName}</span>
            </summary>
            <div className="absolute right-0 mt-1 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              <Link href="/account" className="block rounded px-3 py-1.5 text-sm hover:bg-slate-50">Change password</Link>
              <form action={logoutAction}><button className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50">Sign out</button></form>
            </div>
          </details>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {mustChangePassword && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You are using a temporary password. <Link className="link font-semibold" href="/account">Change it now</Link>.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
