// Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD. Default: the month of the latest settled data, up to that day.
import "server-only";
import { createClient } from "./supabase/server";

export type Period = { from: string; to: string; days: number; latest: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export function todayIst() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Latest day with sales data: Amazon settled transactions, FirstCry, Myntra or Flipkart orders. */
export async function latestDataDate(accountId: string): Promise<string | null> {
  const supabase = await createClient();
  const [amz, fc, my, fk] = await Promise.all([
    supabase.from("sd_transactions").select("posted_date").eq("account_id", accountId).order("posted_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sd_fc_sales").select("order_date").eq("account_id", accountId).order("order_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sd_my_orders").select("order_date").eq("account_id", accountId).order("order_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sd_fk_orders").select("order_date").eq("account_id", accountId).order("order_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dates = [amz.data?.posted_date as string | undefined, fc.data?.order_date as string | undefined, my.data?.order_date as string | undefined, fk.data?.order_date as string | undefined].filter(Boolean) as string[];
  return dates.sort().pop() ?? null;
}

export async function getPeriod(accountId: string, sp: { from?: string; to?: string }): Promise<Period> {
  const latest = await latestDataDate(accountId);
  let to = sp.to && ISO.test(sp.to) ? sp.to : latest ?? todayIst();
  let from = sp.from && ISO.test(sp.from) ? sp.from : `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  return { from, to, days: dayDiff(from, to), latest };
}

export function addDays(iso: string, n: number) {
  return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Preset ranges relative to the latest data date. */
export function presets(latest: string) {
  const first = `${latest.slice(0, 8)}01`;
  const prevEnd = addDays(first, -1);
  return [
    { label: "Last 7 days", from: addDays(latest, -6), to: latest },
    { label: "Last 30 days", from: addDays(latest, -29), to: latest },
    { label: "This month", from: first, to: latest },
    { label: "Last month", from: `${prevEnd.slice(0, 8)}01`, to: prevEnd },
  ];
}

/** Date range for a brand: defaults to the month of the latest data across its marketplaces. */
export async function getBrandPeriod(accountIds: string[], sp: { from?: string; to?: string }): Promise<Period> {
  const dates = (await Promise.all(accountIds.map(latestDataDate))).filter(Boolean) as string[];
  const latest = dates.sort().pop() ?? null;
  let to = sp.to && ISO.test(sp.to) ? sp.to : latest ?? todayIst();
  let from = sp.from && ISO.test(sp.from) ? sp.from : `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  return { from, to, days: dayDiff(from, to), latest };
}

/** Earliest day with sales data, so a "vs previous period" comparison is only made when that period is fully covered. */
export async function earliestDataDate(accountId: string): Promise<string | null> {
  const supabase = await createClient();
  const [amz, fc, my, fk] = await Promise.all([
    supabase.from("sd_transactions").select("posted_date").eq("account_id", accountId).order("posted_date", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("sd_fc_sales").select("order_date").eq("account_id", accountId).order("order_date", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("sd_my_orders").select("order_date").eq("account_id", accountId).order("order_date", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("sd_fk_orders").select("order_date").eq("account_id", accountId).order("order_date", { ascending: true }).limit(1).maybeSingle(),
  ]);
  const dates = [amz.data?.posted_date as string | undefined, fc.data?.order_date as string | undefined, my.data?.order_date as string | undefined, fk.data?.order_date as string | undefined].filter(Boolean) as string[];
  return dates.sort()[0] ?? null;
}
