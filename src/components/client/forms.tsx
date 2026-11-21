"use client";
import React, { createContext, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

type State = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; at?: number } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

const FieldErrors = createContext<Record<string, string>>({});
export const useFieldError = (name: string) => useContext(FieldErrors)[name];

/** Form bound to a server action; shows success/error, keeps field errors, and refreshes data on success. */
export function ActionForm({ action, children, className, resetOnSuccess, onSuccess, confirm }: {
  action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; onSuccess?: () => void; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <FieldErrors.Provider value={state?.fieldErrors ?? {}}>
      <form ref={ref} action={formAction} className={className} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }} noValidate={false}>
        {state?.error && <div role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</div>}
        {state?.ok && state.message && <div role="status" className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</div>}
        {children}
      </form>
    </FieldErrors.Provider>
  );
}

/** Submit button that disables itself while the request runs (prevents double submission). */
export function Submit({ children, className = "btn-primary", name, value, disabled }: { children: React.ReactNode; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={pending || disabled} aria-busy={pending}>{pending ? "Working…" : children}</button>;
}

export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? <p className="field-error">{e}</p> : null;
}

/** One-time token so a re-submitted form (double click, back button) can never create two records. */
export function Idempotency() {
  const [k] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)));
  return <input type="hidden" name="idempotencyKey" value={k} />;
}

/**
 * High-risk action button: opens a dialog that requires a reason (when `reason`), confirms, then submits to the server action.
 */
export function ReasonAction({ action, label, title, description, hidden = {}, reason = true, reasonLabel = "Reason", className = "btn-danger", confirmLabel, extra }: {
  action: Action; label: string; title: string; description?: React.ReactNode; hidden?: Record<string, string | number>; reason?: boolean; reasonLabel?: string; className?: string; confirmLabel?: string; extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="m-auto w-[min(32rem,92vw)] rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40">
        <ActionForm action={action} className="p-5" onSuccess={() => ref.current?.close()}>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <div className="mt-1 text-sm text-slate-600">{description}</div>}
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          {extra}
          {reason && (
            <div className="mt-3">
              <label htmlFor={`reason-${title}`} className="mb-1 block">{reasonLabel} <span className="text-rose-600">*</span></label>
              <textarea id={`reason-${title}`} name="reason" required minLength={3} rows={3} />
              <FieldError name="reason" />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => ref.current?.close()}>Cancel</button>
            <Submit className={className}>{confirmLabel ?? label}</Submit>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}

/** Small inline action (single button) with optional confirm prompt. */
export function InlineAction({ action, label, hidden = {}, className = "btn-secondary btn-sm", confirm }: { action: Action; label: string; hidden?: Record<string, string | number>; className?: string; confirm?: string }) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      <Submit className={className}>{label}</Submit>
    </ActionForm>
  );
}
