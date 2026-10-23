"use client";

import { useActionState } from "react";
import { saveAccountDefaults, type SaveState } from "./actions";

type Props = { accountId: string; costPct: number; lead: number; safety: number; horizon: number };

export default function DefaultsForm({ accountId, costPct, lead, safety, horizon }: Props) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveAccountDefaults, null);
  const f = (name: string, label: string, value: number, suffix: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-1.5"><input name={name} defaultValue={value} inputMode="decimal" className="field !w-24 text-right" /><span className="text-xs text-muted">{suffix}</span></span>
    </label>
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-4 px-4 py-4">
      <input type="hidden" name="accountId" value={accountId} />
      {f("default_cost_pct", "Default product cost", Math.round(costPct * 1000) / 10, "% of price")}
      {f("default_lead_time_days", "Manufacturing lead time", lead, "days")}
      {f("default_safety_days", "Safety buffer", safety, "days")}
      {f("plan_horizon_days", "Plan horizon", horizon, "days")}
      <button disabled={pending} className="btn btn-dark">{pending ? "Saving…" : "Save defaults"}</button>
      {state && <span className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
