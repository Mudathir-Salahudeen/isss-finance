import Link from "next/link";
import { requirePage } from "@/server/session";
import { globalSearch } from "@/server/services/auditlog";
import { PageHeader, Card, Badge } from "@/components/ui";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const a = await requirePage();
  const q = (await searchParams).q ?? "";
  const res = await globalSearch(a, q);
  return (
    <>
      <PageHeader title={q ? `Search: “${q}”` : "Search"} subtitle="Results are limited to what your role can see." />
      <form action="/search" className="mb-4"><label htmlFor="sq2" className="sr-only">Search</label><input id="sq2" name="q" type="search" defaultValue={q} placeholder="Student, admission no., payment ref., receipt no., staff, expense…" /></form>
      <Card pad={false}>
        <ul className="divide-y divide-slate-100">{res.map((r, i) => <li key={i}><Link href={r.href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><Badge tone="emerald">{r.type}</Badge><span className="font-medium">{r.label}</span><span className="text-sm text-slate-500">{r.sub}</span></Link></li>)}</ul>
        {!res.length && <p className="p-5 text-sm text-slate-500">{q.length < 2 ? "Type at least 2 characters." : "No matches."}</p>}
      </Card>
    </>
  );
}
