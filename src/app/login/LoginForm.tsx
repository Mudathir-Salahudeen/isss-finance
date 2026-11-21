"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ schoolName, hasLogo }: { schoolName: string; hasLogo: boolean }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-50 p-4">
      <form action={action} className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
        {hasLogo ? <img src="/api/logo" alt={`${schoolName} logo`} className="mx-auto mb-4 h-28 object-contain" /> : <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-brand-600 font-bold text-white">₦</div>}<h1 className="text-center text-lg font-semibold text-slate-900">{schoolName}</h1>
        <p className="mb-5 text-center text-sm text-slate-500">Financial Management &amp; Control — sign in to continue</p>
        {state?.error && <div role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</div>}
        <label htmlFor="email" className="mb-1 block">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="mb-3" />
        <label htmlFor="password" className="mb-1 block">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="mb-5" />
        <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
