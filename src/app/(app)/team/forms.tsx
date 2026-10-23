"use client";

import { useActionState } from "react";
import { createAccount, createSellerLogin, resetSellerPassword, type ActionState } from "./actions";

type Opt = { id: string; name: string };

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div className={`mt-3 rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-700"}`}>
      {state.message}
      {state.password && <div className="mt-1 select-all font-mono text-base font-bold tracking-wide">{state.password}</div>}
    </div>
  );
}

export function NewAccountForm({ clients, marketplaces }: { clients: Opt[]; marketplaces: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAccount, null);
  return (
    <form action={action} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label><span className="label">Client</span><select name="client_id" className="field" required defaultValue=""><option value="" disabled>Choose</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="label">Marketplace</span><select name="marketplace_id" className="field" required defaultValue=""><option value="" disabled>Choose</option>{marketplaces.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label><span className="label">Account name</span><input name="name" className="field" placeholder="Brand — Amazon.in" required /></label>
        <label><span className="label">Seller ID (optional)</span><input name="seller_id" className="field" placeholder="A20LNIW0086CNE" /></label>
      </div>
      <button disabled={pending} className="btn btn-dark mt-3">{pending ? "Adding…" : "Add account"}</button>
      <Result state={state} />
    </form>
  );
}

export function NewSellerForm({ clients }: { clients: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSellerLogin, null);
  return (
    <form action={action} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="label">Seller&apos;s email</span><input name="email" type="email" className="field" required /></label>
        <label><span className="label">Name</span><input name="full_name" className="field" /></label>
        <label><span className="label">Client</span><select name="client_id" className="field" required defaultValue=""><option value="" disabled>Choose</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="can_edit_costs" defaultChecked /> Can enter product costs, lead times and warehouse stock</label>
      <button disabled={pending} className="btn btn-dark mt-3">{pending ? "Creating…" : "Create login"}</button>
      <Result state={state} />
    </form>
  );
}

export function ResetPasswordButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resetSellerPassword, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs font-semibold text-brand hover:underline">{pending ? "…" : "New temporary password"}</button>
      <Result state={state} />
    </form>
  );
}
