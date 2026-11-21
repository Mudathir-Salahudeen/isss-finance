import Link from "next/link";
export default async function Forbidden({ searchParams }: { searchParams: Promise<{ perm?: string }> }) {
  const { perm } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-600">Your role does not include permission to open this page{perm ? <> (<code>{perm}</code>)</> : null}. Ask the Director to update your role if you need access.</p>
        <Link href="/dashboard" className="btn-primary mt-4">Back to dashboard</Link>
      </div>
    </main>
  );
}
