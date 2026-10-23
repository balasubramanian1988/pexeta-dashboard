// Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD. Default: the month of the latest settled data, up to that day.
import "server-only";
import { createClient } from "./supabase/server";

export type Period = { from: string; to: string; days: number; latest: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export function todayIst() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function latestDataDate(accountId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("sd_transactions").select("posted_date").eq("account_id", accountId).order("posted_date", { ascending: false }).limit(1).maybeSingle();
  return data?.posted_date ?? null;
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
