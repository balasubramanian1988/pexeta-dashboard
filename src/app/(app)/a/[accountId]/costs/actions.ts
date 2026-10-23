"use server";
// Seller-maintained product inputs (cost, lead time, own warehouse stock) and team-only account defaults.
import { revalidatePath } from "next/cache";
import { getAccount, getViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type SaveState = { ok: boolean; message: string } | null;

function parseNum(v: FormDataEntryValue | null, { min, max, int }: { min: number; max: number; int?: boolean }): number | null | "bad" {
  const s = String(v ?? "").replace(/[,₹%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return "bad";
  return n;
}

export async function saveProductSetting(_: SaveState, form: FormData): Promise<SaveState> {
  const viewer = await getViewer();
  if (!viewer.canEditCosts) return { ok: false, message: "Your login can view costs but not change them." };
  const account = await getAccount(String(form.get("accountId")));
  const asin = String(form.get("asin") ?? "");
  if (!/^[A-Z0-9]{10}$/.test(asin)) return { ok: false, message: "Unknown product." };

  const admin = createAdminClient();
  const { data: current } = await admin.from("sd_product_settings").select("cost_pct, cost_per_unit, lead_time_days, warehouse_stock").eq("account_id", account.id).eq("asin", asin).maybeSingle();
  const next: Record<string, number | null> = { ...(current ?? { cost_pct: null, cost_per_unit: null, lead_time_days: null, warehouse_stock: null }) };
  const fields = [
    ["cost_pct", { min: 0, max: 100 }],
    ["cost_per_unit", { min: 0, max: 1_000_000 }],
    ["lead_time_days", { min: 0, max: 365, int: true }],
    ["warehouse_stock", { min: 0, max: 10_000_000, int: true }],
  ] as const;
  for (const [k, rule] of fields) {
    if (!form.has(k)) continue; // a form only sends the fields it shows
    const v = parseNum(form.get(k), rule);
    if (v === "bad") return { ok: false, message: `Check the ${k.replace(/_/g, " ")} value.` };
    next[k] = k === "cost_pct" && v != null ? v / 100 : v;
  }
  const { error } = await admin.from("sd_product_settings").upsert({ account_id: account.id, asin, ...next, updated_by: viewer.email, updated_at: new Date().toISOString() }, { onConflict: "account_id,asin" });
  if (error) return { ok: false, message: error.message };

  if (viewer.kind === "team" && form.has("short_name")) {
    const name = String(form.get("short_name") ?? "").trim().slice(0, 80);
    await admin.from("sd_products").update({ short_name: name }).eq("account_id", account.id).eq("asin", asin);
  }
  revalidatePath(`/a/${account.id}`, "layout");
  return { ok: true, message: "Saved" };
}

export async function saveAccountDefaults(_: SaveState, form: FormData): Promise<SaveState> {
  const viewer = await getViewer();
  if (viewer.kind !== "team") return { ok: false, message: "Only the Pexeta team can change account defaults." };
  const account = await getAccount(String(form.get("accountId")));
  const pct = parseNum(form.get("default_cost_pct"), { min: 0, max: 100 });
  const lead = parseNum(form.get("default_lead_time_days"), { min: 0, max: 365, int: true });
  const safety = parseNum(form.get("default_safety_days"), { min: 0, max: 120, int: true });
  const horizon = parseNum(form.get("plan_horizon_days"), { min: 7, max: 180, int: true });
  if ([pct, lead, safety, horizon].some((x) => x === "bad" || x === null)) return { ok: false, message: "Fill every default with a sensible number." };
  const { error } = await createAdminClient().from("sd_accounts").update({
    default_cost_pct: (pct as number) / 100, default_lead_time_days: lead, default_safety_days: safety, plan_horizon_days: horizon,
  }).eq("id", account.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/a/${account.id}`, "layout");
  return { ok: true, message: "Defaults saved" };
}
