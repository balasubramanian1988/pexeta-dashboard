"use client";
// One table row's inputs, saved with a server action. Used by Product costs and the stock plan.
import { useActionState } from "react";
import { saveProductSetting, type SaveState } from "@/app/(app)/a/[accountId]/costs/actions";

export type Field = { name: "cost_pct" | "cost_per_unit" | "lead_time_days" | "warehouse_stock" | "short_name"; value: string | number | null; placeholder?: string; width?: string; label: string; text?: boolean };

export default function SettingForm({ accountId, asin, fields, disabled }: { accountId: string; asin: string; fields: Field[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveProductSetting, null);
  return (
    <form action={action} className="flex flex-nowrap items-center justify-end gap-1.5">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="asin" value={asin} />
      {fields.map((f) => (
        <input key={f.name} name={f.name} aria-label={f.label} title={f.label} disabled={disabled}
          defaultValue={f.value ?? ""} placeholder={f.placeholder} inputMode={f.text ? "text" : "decimal"}
          className={`field !py-1 !text-xs ${f.text ? "" : "text-right"} ${f.width ?? "!w-20"}`} />
      ))}
      {!disabled && <button disabled={pending} className="btn btn-outline !px-2 !py-1 !text-xs">{pending ? "…" : "Save"}</button>}
      {state && <span className={`whitespace-nowrap text-[11px] ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
