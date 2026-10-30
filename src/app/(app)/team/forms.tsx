"use client";

import { useActionState, useState } from "react";
import { addBrandMarketplace, createBrand, createSellerLogin, resetSellerPassword, type ActionState } from "./actions";

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

/** New brand: name plus the marketplaces it sells on. Only the ticked marketplaces appear on its dashboard. */
export function NewBrandForm({ clients, marketplaces }: { clients: Opt[]; marketplaces: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBrand, null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  return (
    <form action={action} className="px-4 py-4">
      <label className="block max-w-md">
        <span className="label">Brand name</span>
        <input name="brand" className="field" list="known-brands" placeholder="e.g. Root and Soil" required />
        <datalist id="known-brands">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <span className="mt-1 block text-xs text-faint">If the brand is already a client in Pexeta Ops, pick it so both tools stay linked.</span>
      </label>
      <fieldset className="mt-4">
        <legend className="label">Marketplaces the brand sells on</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {marketplaces.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
              <label className="flex min-h-[28px] items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="marketplace_id" value={m.id} onChange={(e) => setTicked((t) => ({ ...t, [m.id]: e.target.checked }))} />
                {m.name}
              </label>
              {ticked[m.id] && <input name={`seller_${m.id}`} className="field max-w-[220px] flex-1 py-1.5 text-xs" placeholder="Seller ID (optional)" aria-label={`${m.name} seller ID`} />}
            </div>
          ))}
        </div>
      </fieldset>
      <button disabled={pending} className="btn btn-dark mt-4">{pending ? "Adding…" : "Add brand"}</button>
      <Result state={state} />
    </form>
  );
}

/** Opt an existing brand into another marketplace, including one not on the list yet. */
export function AddMarketplaceForm({ clientId, marketplaces }: { clientId: string; marketplaces: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBrandMarketplace, null);
  const [choice, setChoice] = useState("");
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 px-4 py-3">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="min-w-[180px]">
        <span className="label">Marketplace</span>
        <select name="marketplace_id" className="field" required value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="" disabled>Choose</option>
          {marketplaces.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="new">A marketplace not on this list…</option>
        </select>
      </label>
      {choice === "new" && (
        <label className="min-w-[180px]"><span className="label">New marketplace name</span><input name="new_marketplace" className="field" placeholder="e.g. Meesho" required /></label>
      )}
      <label className="min-w-[180px]"><span className="label">Seller ID (optional)</span><input name="seller_id" className="field" /></label>
      <button disabled={pending} className="btn btn-primary">{pending ? "Adding…" : "Add marketplace"}</button>
      <div className="w-full"><Result state={state} /></div>
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
