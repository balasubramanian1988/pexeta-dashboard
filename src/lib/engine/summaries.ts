// Small aggregations used by the Overview, Revenue and Ads pages.
import type { AdRow, TxnRow } from "./types";

export function eachDay(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Net sales excl. GST per posting day (orders minus refunds, after promotions). */
export function dailyNetSales(txns: TxnRow[], from: string, to: string) {
  const m = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "Order" && t.type !== "Refund") continue;
    m.set(t.posted_date, (m.get(t.posted_date) ?? 0) + t.product_sales + t.shipping_credits + t.gift_wrap_credits + t.promotional_rebates);
  }
  return eachDay(from, to).map((date) => ({ date, value: m.get(date) ?? 0 }));
}

export function dailyAdSpend(ads: AdRow[], from: string, to: string) {
  const m = new Map<string, number>();
  for (const a of ads) m.set(a.date, (m.get(a.date) ?? 0) + a.spend);
  return eachDay(from, to).map((date) => ({ date, value: m.get(date) ?? 0 }));
}

export type AdAgg = { key: string; adType: string; label: string; spend: number; sales: number; clicks: number; impressions: number; orders: number };
export function aggregateAds(ads: AdRow[], by: "type" | "campaign"): AdAgg[] {
  const m = new Map<string, AdAgg>();
  for (const a of ads) {
    const key = by === "type" ? a.ad_type : `${a.ad_type}␟${a.campaign}`;
    const x = m.get(key) ?? { key, adType: a.ad_type, label: by === "type" ? a.ad_type : a.campaign, spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };
    x.spend += a.spend; x.sales += a.sales; x.clicks += a.clicks; x.impressions += a.impressions; x.orders += a.orders;
    m.set(key, x);
  }
  return [...m.values()].sort((a, b) => b.spend - a.spend);
}

export const AD_TYPE_LABEL: Record<string, string> = { SP: "Sponsored Products", SB: "Sponsored Brands", SD: "Sponsored Display" };
