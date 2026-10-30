// Reads for the dashboard pages. All reads run as the signed-in user, so row-level security applies.
import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { computeProfit } from "./engine/profit";
import { computeStock } from "./engine/stock";
import type { AccountDefaults, AdRow, InventoryRow, ListingRow, ProductRow, ProductSetting, SbPurchaseRow, SkuRow, TxnRow } from "./engine/types";
import type { Account } from "./auth";
import type { Finding, MarketSummary } from "./engine/brand";
import { dailyNetSales } from "./engine/summaries";
import { computeFcStock, computeFirstCry, type FcProduct, type FcRateRow, type FcReconRow, type FcReturnRow, type FcSaleRow } from "./engine/firstcry";
import { addDays } from "./period";

type Sb = Awaited<ReturnType<typeof createClient>>;
type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Supabase returns at most 1,000 rows per request; page through the rest. */
export async function fetchAll<T>(build: (from: number, to: number) => Res<T>, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

const TXN_COLS = "posted_date, type, order_id, sku, description, quantity, product_sales, shipping_credits, gift_wrap_credits, promotional_rebates, tax_liable, tcs_cgst, tcs_sgst, tcs_igst, tds, selling_fees, fba_fees, other_transaction_fees, other, total";

const numify = <T extends Record<string, unknown>>(rows: T[], keys: string[]) =>
  rows.map((r) => { const x: Record<string, unknown> = { ...r }; for (const k of keys) x[k] = Number(x[k] ?? 0); return x as T; });

export const getMaster = cache(async (accountId: string) => {
  const sb = await createClient();
  const [products, skus, settings] = await Promise.all([
    fetchAll<ProductRow>((f, t) => sb.from("sd_products").select("asin, title, short_name").eq("account_id", accountId).range(f, t)),
    fetchAll<SkuRow>((f, t) => sb.from("sd_skus").select("sku, asin, fulfillment").eq("account_id", accountId).range(f, t)),
    fetchAll<ProductSetting>((f, t) => sb.from("sd_product_settings").select("asin, cost_pct, cost_per_unit, lead_time_days, warehouse_stock").eq("account_id", accountId).range(f, t)),
  ]);
  return { products, skus, settings };
});

export async function getTransactions(sb: Sb, accountId: string, from: string, to: string): Promise<TxnRow[]> {
  const rows = await fetchAll<TxnRow>((f, t) => sb.from("sd_transactions").select(TXN_COLS).eq("account_id", accountId).gte("posted_date", from).lte("posted_date", to).order("row_hash").range(f, t));
  return numify(rows, ["quantity", "product_sales", "shipping_credits", "gift_wrap_credits", "promotional_rebates", "tax_liable", "tcs_cgst", "tcs_sgst", "tcs_igst", "tds", "selling_fees", "fba_fees", "other_transaction_fees", "other", "total"]);
}

export async function getAds(sb: Sb, accountId: string, from: string, to: string) {
  const [ads, sbp] = await Promise.all([
    fetchAll<AdRow>((f, t) => sb.from("sd_ads").select("date, ad_type, asin, campaign, spend, sales, clicks, impressions, orders, units").eq("account_id", accountId).gte("date", from).lte("date", to).order("date").order("campaign").order("ad_group").order("target").order("asin").range(f, t)),
    fetchAll<SbPurchaseRow>((f, t) => sb.from("sd_sb_purchases").select("date, asin, sales, units").eq("account_id", accountId).gte("date", from).lte("date", to).order("date").order("campaign").order("attribution").order("asin").range(f, t)),
  ]);
  return { ads: numify(ads, ["spend", "sales", "clicks", "impressions", "orders", "units"]), sbPurchases: numify(sbp, ["sales", "units"]) };
}

export function defaultsOf(a: Account): AccountDefaults {
  return { default_cost_pct: a.default_cost_pct, default_lead_time_days: a.default_lead_time_days, default_safety_days: a.default_safety_days, plan_horizon_days: a.plan_horizon_days };
}

export const getProfit = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [txns, { ads, sbPurchases }, master] = await Promise.all([getTransactions(sb, account.id, from, to), getAds(sb, account.id, from, to), getMaster(account.id)]);
  const result = computeProfit({ txns, ads, sbPurchases, ...master, defaults: defaultsOf(account) });
  return { result, txns, ads, sbPurchases, master };
});

/** Latest snapshot rows of an FBA inventory / listings table. */
async function latestSnapshot<T>(sb: Sb, table: "sd_inventory" | "sd_listings", accountId: string, cols: string) {
  const { data } = await sb.from(table).select("snapshot_date").eq("account_id", accountId).order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  const date = (data as { snapshot_date: string } | null)?.snapshot_date ?? null;
  if (!date) return { date: null, rows: [] as T[] };
  const rows = await fetchAll<T>((f, t) => sb.from(table).select(cols).eq("account_id", accountId).eq("snapshot_date", date).order("sku").range(f, t) as unknown as Res<T>);
  return { date, rows };
}

export const getStock = cache(async (account: Account, from: string, to: string, days: number) => {
  const sb = await createClient();
  const [txns, inv, lst, master] = await Promise.all([
    getTransactions(sb, account.id, from, to),
    latestSnapshot<InventoryRow>(sb, "sd_inventory", account.id, "sku, asin, fulfillable, reserved, inbound_working, inbound_shipped, inbound_receiving"),
    latestSnapshot<ListingRow>(sb, "sd_listings", account.id, "sku, asin, quantity, channel"),
    getMaster(account.id),
  ]);
  const asinOf = new Map(master.skus.map((s) => [s.sku, s.asin]));
  const units = new Map<string, number>();
  for (const t of txns) if (t.type === "Order") { const a = asinOf.get(t.sku); if (a) units.set(a, (units.get(a) ?? 0) + t.quantity); }
  const rows = computeStock({ unitsByAsin: units, periodDays: days, inventory: inv.rows, listings: lst.rows, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
  return { rows, inventoryDate: inv.date, listingsDate: lst.date };
});

/** Latest upload of each report type, for the "data up to" notes. */
export async function getFreshness(accountId: string) {
  const sb = await createClient();
  const { data } = await sb.from("sd_uploads").select("report_type, period_end, created_at, status").eq("account_id", accountId).eq("status", "done").order("created_at", { ascending: false }).limit(300);
  const out: Record<string, { periodEnd: string | null; uploadedAt: string }> = {};
  for (const u of data ?? []) if (!out[u.report_type]) out[u.report_type] = { periodEnd: u.period_end, uploadedAt: u.created_at };
  return out;
}

// ---------- FirstCry ----------

const FC_RECON_COLS = "poid, poitem_id, product_id, order_date, delivery_date, return_date, quantity, mrp, base_cost, gross_amount, gst_rate, gst_amount, total, vendor_invoice, payment_advice, debit_note, sr_qty, sr_gross, sr_total, rto_qty, rto_gross, rto_total";
const FC_RECON_NUM = ["quantity", "mrp", "base_cost", "gross_amount", "gst_rate", "gst_amount", "total", "sr_qty", "sr_gross", "sr_total", "rto_qty", "rto_gross", "rto_total"];

export const getFcMaster = cache(async (accountId: string) => {
  const sb = await createClient();
  const [products, settings] = await Promise.all([
    fetchAll<FcProduct>((f, t) => sb.from("sd_products").select("asin, title, short_name, mrp, gst_rate, style_code").eq("account_id", accountId).range(f, t)),
    fetchAll<ProductSetting>((f, t) => sb.from("sd_product_settings").select("asin, cost_pct, cost_per_unit, lead_time_days, warehouse_stock").eq("account_id", accountId).range(f, t)),
  ]);
  return { products: products.map((p) => ({ ...p, mrp: p.mrp == null ? null : Number(p.mrp), gst_rate: p.gst_rate == null ? null : Number(p.gst_rate) })), settings };
});

async function fcSales(sb: Sb, accountId: string, from: string, to: string) {
  const rows = await fetchAll<FcSaleRow>((f, t) => sb.from("sd_fc_sales").select("poid, product_id, order_date, quantity, mrp, mrp_sales").eq("account_id", accountId).gte("order_date", from).lte("order_date", to).order("row_key").range(f, t));
  return numify(rows, ["quantity", "mrp", "mrp_sales"]);
}

export const getFirstCry = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [sales, recon, rates, returns, master] = await Promise.all([
    fcSales(sb, account.id, from, to),
    fetchAll<FcReconRow>((f, t) => sb.from("sd_fc_recon").select(FC_RECON_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, FC_RECON_NUM)),
    // Payout history for estimates and the usual payout rate: the 180 days up to the end of the period.
    fetchAll<FcRateRow>((f, t) => sb.from("sd_fc_recon").select("product_id, order_date, base_cost, mrp, gst_rate").eq("account_id", account.id).gte("order_date", addDays(to, -179)).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["base_cost", "mrp", "gst_rate"])),
    fetchAll<FcReturnRow>((f, t) => sb.from("sd_fc_returns").select("poid, product_id, return_date, quantity, reason, sub_reason").eq("account_id", account.id).gte("return_date", from).lte("return_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["quantity"])),
    getFcMaster(account.id),
  ]);
  const result = computeFirstCry({ sales, recon, rates, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
  return { result, returns, master, hasSales: sales.length > 0, hasRecon: recon.length > 0 };
});

export const getFcStock = cache(async (account: Account, from: string, to: string, days: number) => {
  const sb = await createClient();
  const [sales, master] = await Promise.all([fcSales(sb, account.id, from, to), getFcMaster(account.id)]);
  const units = new Map<string, number>();
  for (const s of sales) if (s.quantity > 0) units.set(s.product_id, (units.get(s.product_id) ?? 0) + s.quantity);
  return computeFcStock({ unitsById: units, periodDays: days, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
});

// ---------- One brand across marketplaces ----------

const SUPPORTED = new Set(["Amazon", "FirstCry"]);

async function summarise(account: Account, from: string, to: string, prevFrom: string, prevTo: string): Promise<{ s: MarketSummary; extra: Finding[] }> {
  const base = { accountId: account.id, marketplace: account.marketplace, notes: [] as string[], daily: new Map<string, number>() };
  const empty: MarketSummary = { ...base, supported: SUPPORTED.has(account.marketplace), hasData: false, sales: 0, units: 0, returnRate: null, fees: 0, ads: null, productCost: 0, profit: 0, margin: 0, prevSales: null, lossProducts: 0 };
  if (account.marketplace === "Amazon") {
    const [{ result, txns }, prev] = await Promise.all([getProfit(account, from, to), getProfit(account, prevFrom, prevTo)]);
    if (!txns.length) return { s: empty, extra: [] };
    const t = result.totals;
    // Account-level charges (e.g. ads on products with no sales, storage) belong to the marketplace too.
    const profit = result.profitAfterAccountLevel;
    return {
      s: {
        ...empty, hasData: true, sales: t.netSales, units: t.units, returnRate: t.unitsSold ? t.unitsRefunded / t.unitsSold : null,
        fees: t.fees, ads: t.ads, productCost: t.productCost, profit, margin: t.netSales ? profit / t.netSales : 0,
        prevSales: prev.txns.length ? prev.result.totals.netSales : null,
        daily: new Map(dailyNetSales(txns, from, to).map((d) => [d.date, d.value])),
        lossProducts: result.rows.filter((r) => r.profit < 0).length,
      },
      extra: [],
    };
  }
  if (account.marketplace === "FirstCry") {
    const [cur, prev] = await Promise.all([getFirstCry(account, from, to), getFirstCry(account, prevFrom, prevTo)]);
    if (!cur.hasSales && !cur.hasRecon) return { s: empty, extra: [] };
    const t = cur.result.totals;
    const extra: Finding[] = [];
    if (t.shortfall > 0) extra.push({ tone: "bad", title: `FirstCry paid about ₹${Math.round(t.shortfall).toLocaleString("en-IN")} less than its usual rate`, detail: `On ${cur.result.rows.filter((r) => r.shortfall > 0).length} product(s) whose GST rate changed but base cost did not. See FirstCry › Payments.` });
    return {
      s: {
        ...empty, hasData: true, sales: t.salesExGst, units: t.units - t.rtoUnits - t.returnUnits,
        returnRate: t.shippedUnits ? (t.rtoUnits + t.returnUnits) / t.shippedUnits : null,
        fees: t.salesExGst - t.revenue, ads: null, productCost: t.productCost, profit: t.profit, margin: t.margin,
        prevSales: prev.hasSales || prev.hasRecon ? prev.result.totals.salesExGst : null,
        daily: new Map(cur.result.daily.map((d) => [d.date, d.sales])),
        lossProducts: cur.result.rows.filter((r) => r.profit < 0).length,
        notes: ["Sales at MRP excl. GST: FirstCry's files show no customer price.", ...(t.revenueEstimated ? ["Includes orders not yet invoiced, estimated."] : [])],
      },
      extra,
    };
  }
  return { s: { ...empty, notes: ["Reports from this marketplace are not read by the dashboard yet."] }, extra: [] };
}

export const getBrand = cache(async (accounts: Account[], from: string, to: string, days: number) => {
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const res = await Promise.all(accounts.map((a) => summarise(a, from, to, prevFrom, prevTo)));
  return { markets: res.map((r) => r.s), extra: res.flatMap((r) => r.extra), prevFrom, prevTo };
});
