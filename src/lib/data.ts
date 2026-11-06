// Reads for the dashboard pages. All reads run as the signed-in user, so row-level security applies.
import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { computeProfit } from "./engine/profit";
import { computeStock } from "./engine/stock";
import type { AccountDefaults, AdRow, InventoryRow, ListingRow, ProductRow, ProductSetting, SbPurchaseRow, SkuRow, TxnRow } from "./engine/types";
import type { Account } from "./auth";
import { computeFlipkart, fkPayouts, type FkAdRow, type FkOrderRow, type FkOtherRow, type FkRateRow, type FkReturnRow, type FkSaleRow, type FkSettlementRow } from "./engine/flipkart";
import { computeMyntra, type MyAdStyleRow, type MyDeductionRow, type MyInvoiceRow, type MyOrderRow, type MyRateRow, type MyReturnRow, type MySettlementRow } from "./engine/myntra";
import type { Finding, MarketSummary } from "./engine/brand";
import { dailyNetSales } from "./engine/summaries";
import { computeFcStock, computeFirstCry, fcAdsInPeriod, type FcAdRow, type FcProduct, type FcRateRow, type FcReconRow, type FcReturnRow, type FcSaleRow } from "./engine/firstcry";
import { addDays, earliestDataDate, latestDataDate } from "./period";
import { computeSearch, type AsinRow, type BasketRow, type QueryRow } from "./engine/search";
import { computeReturns, type ReturnLine } from "./engine/returns";
import { computeReturnsMoney, type AmzReturnRow, type FeeRow, type ReimbRow, type RefundRow } from "./engine/returnsMoney";
import { computeWarehouseClaims, reimbursementReason, type LedgerRow, type ReimbursementRow } from "./engine/warehouseClaims";

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
  // Ads: a monthly row covers its whole month, so read from the first of the month the period starts in.
  const adRows = await fetchAll<FcAdRow>((f, t) => sb.from("sd_fc_ads").select("grain, period_date, product_id, campaign, spend, impressions, clicks, ad_sales, orders").eq("account_id", account.id).gte("period_date", `${from.slice(0, 7)}-01`).lte("period_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["spend", "impressions", "clicks", "ad_sales", "orders"]));
  const ads = adRows.length ? fcAdsInPeriod(adRows, from, to) : null;
  return { result, returns, master, ads, hasSales: sales.length > 0, hasRecon: recon.length > 0 };
});

export const getFcStock = cache(async (account: Account, from: string, to: string, days: number) => {
  const sb = await createClient();
  const [sales, master] = await Promise.all([fcSales(sb, account.id, from, to), getFcMaster(account.id)]);
  const units = new Map<string, number>();
  for (const s of sales) if (s.quantity > 0) units.set(s.product_id, (units.get(s.product_id) ?? 0) + s.quantity);
  return computeFcStock({ unitsById: units, periodDays: days, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
});

// ---------- One brand across marketplaces ----------

const SUPPORTED = new Set(["Amazon", "FirstCry", "Myntra", "Flipkart"]);

async function summarise(account: Account, from: string, to: string, prevFrom: string, prevTo: string): Promise<{ s: MarketSummary; extra: Finding[] }> {
  const base = { accountId: account.id, marketplace: account.marketplace, notes: [] as string[], daily: new Map<string, number>() };
  const empty: MarketSummary = { ...base, supported: SUPPORTED.has(account.marketplace), hasData: false, sales: 0, units: 0, returnRate: null, fees: 0, ads: null, productCost: 0, profit: 0, margin: 0, prevSales: null, lossProducts: 0, products: [] };
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
        products: result.rows.map((r) => ({ code: r.asin, name: r.name, units: r.units, sales: r.netSales, fees: r.fees, ads: r.ads, productCost: r.productCost, profit: r.profit, margin: r.margin })),
      },
      extra: [],
    };
  }
  if (account.marketplace === "FirstCry") {
    const [cur, prev] = await Promise.all([getFirstCry(account, from, to), getFirstCry(account, prevFrom, prevTo)]);
    if (!cur.hasSales && !cur.hasRecon) return { s: empty, extra: [] };
    const t = cur.result.totals;
    const ads = cur.ads?.spend ?? null;
    const profit = t.profit - (ads ?? 0);
    const extra: Finding[] = [];
    if (t.shortfall > 0) extra.push({ tone: "bad", title: `FirstCry paid about ₹${Math.round(t.shortfall).toLocaleString("en-IN")} less than its usual rate`, detail: `On ${cur.result.rows.filter((r) => r.shortfall > 0).length} product(s) whose GST rate changed but base cost did not. See FirstCry › Payments.` });
    return {
      s: {
        ...empty, hasData: true, sales: t.salesExGst, units: t.units - t.rtoUnits - t.returnUnits,
        returnRate: t.shippedUnits ? (t.rtoUnits + t.returnUnits) / t.shippedUnits : null,
        fees: t.salesExGst - t.revenue, ads, productCost: t.productCost, profit, margin: t.salesExGst ? profit / t.salesExGst : 0,
        prevSales: prev.hasSales || prev.hasRecon ? prev.result.totals.salesExGst : null,
        daily: new Map(cur.result.daily.map((d) => [d.date, d.sales])),
        lossProducts: cur.result.rows.filter((r) => r.profit < 0).length,
        products: cur.result.rows.map((r) => {
          const a = cur.ads?.byProduct.size ? cur.ads.byProduct.get(r.id) ?? 0 : null;
          const p = r.profit - (a ?? 0);
          return { code: r.styleCode || r.id, name: r.name, units: r.keptUnits, sales: r.salesExGst, fees: r.salesExGst - r.revenue, ads: a, productCost: r.productCost, profit: p, margin: r.salesExGst ? p / r.salesExGst : 0 };
        }),
        notes: [
          "Sales at MRP excl. GST: FirstCry's files show no customer price.",
          ...(t.revenueEstimated ? ["Includes orders not yet invoiced, estimated."] : []),
          ...(cur.ads?.spread ? ["Ads from FirstCry's monthly ads report, spread evenly over the month's days."] : []),
          ...(cur.ads && !cur.ads.byProduct.size ? ["Ads are not split by product: the ads report has no product column."] : []),
        ],
      },
      extra,
    };
  }
  if (account.marketplace === "Myntra") {
    const [cur, prev] = await Promise.all([getMyntra(account, from, to), getMyntra(account, prevFrom, prevTo)]);
    if (!cur.hasData) return { s: empty, extra: [] };
    const t = cur.result.totals;
    return {
      s: {
        ...empty, hasData: true, sales: t.sales, units: t.units - t.returnUnits,
        returnRate: t.shipped ? (t.rtoUnits + t.returnUnits) / t.shipped : null,
        // What Myntra keeps: its margin off the customer price, plus commission and shipping.
        fees: t.myntraMargin + t.fees, ads: cur.result.ads.length ? t.ads : null, productCost: t.productCost, profit: t.profit, margin: t.margin,
        prevSales: prev.hasData ? prev.result.totals.sales : null,
        daily: new Map(cur.result.daily.map((d) => [d.date, d.sales])),
        lossProducts: cur.result.rows.filter((r) => r.profit < 0).length,
        products: cur.result.rows.map((r) => ({ code: r.sku, name: r.name, units: r.units - r.returnUnits, sales: r.sales, fees: r.myntraMargin + r.fees, ads: cur.result.ads.length ? r.ads : null, productCost: r.productCost, profit: r.profit, margin: r.margin })),
        notes: t.estimatedLines ? [`${t.estimatedLines} orders estimated: not in a settlement file yet.`] : [],
      },
      extra: [],
    };
  }
  if (account.marketplace === "Flipkart") {
    const [cur, prev] = await Promise.all([getFlipkart(account, from, to), getFlipkart(account, prevFrom, prevTo)]);
    if (!cur.hasData) return { s: empty, extra: [] };
    const t = cur.result.totals;
    const hasAds = !!cur.result.ads;
    return {
      s: {
        ...empty, hasData: true, sales: t.sales, units: t.units - t.returnUnits,
        returnRate: t.shipped ? (t.rtoUnits + t.returnUnits) / t.shipped : null,
        // What Flipkart keeps, net of the offers it funds.
        fees: t.fees - t.offers, ads: hasAds ? t.ads : null, productCost: t.productCost, profit: t.profit, margin: t.margin,
        prevSales: prev.hasData ? prev.result.totals.sales : null,
        daily: new Map(cur.result.daily.map((d) => [d.date, d.sales])),
        lossProducts: cur.result.rows.filter((r) => r.profit < 0).length,
        products: cur.result.rows.map((r) => ({ code: r.sku, name: r.name, units: r.units - r.returnUnits, sales: r.sales, fees: r.fees - r.offers, ads: hasAds ? r.ads : null, productCost: r.productCost, profit: r.profit, margin: r.margin })),
        notes: [
          ...(t.estimatedLines ? [`${t.estimatedLines} orders estimated: not in a settlement report yet.`] : []),
          ...(cur.result.ads?.spread ? ["Some ads days come from a monthly product report, spread evenly."] : []),
        ],
      },
      extra: [],
    };
  }
  return { s: { ...empty, notes: ["Reports from this marketplace are not read by the dashboard yet."] }, extra: [] };
}

export const getBrand = cache(async (accounts: Account[], from: string, to: string, days: number) => {
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const res = await Promise.all(accounts.map(async (a) => {
    const [r, earliest] = await Promise.all([summarise(a, from, to, prevFrom, prevTo), earliestDataDate(a.id)]);
    // Only compare with the previous period when uploads cover all of it; a part-covered period makes growth look huge.
    if (!earliest || earliest > prevFrom) r.s.prevSales = null;
    return r;
  }));
  return { markets: res.map((r) => r.s), extra: res.flatMap((r) => r.extra), prevFrom, prevTo };
});

// ---------- Myntra ----------
const MY_ORDER_COLS = "order_line_id, order_release_id, order_date, sku, sku_id, style_name, status, cancellation_reason, final_amount, total_mrp, seller_price, gt_charges, shipped_on, delivered_on, rto_date";
const MY_SETTLE_COLS = "kind, order_line_id, order_date, sku_id, customer_paid, seller_product_amount, commission, logistics, tcs, tds, tax_rate, expected_settled, settled, settlement_date, settled_postpaid, utr_postpaid, date_postpaid, settled_prepaid, utr_prepaid, date_prepaid";
const MY_SETTLE_NUM = ["customer_paid", "seller_product_amount", "commission", "logistics", "tcs", "tds", "tax_rate", "expected_settled", "settled", "settled_postpaid", "settled_prepaid"];

export const getMyntra = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [orders, settlement, rates, returns, invoices, deductions, skuRows, master] = await Promise.all([
    fetchAll<MyOrderRow>((f, t) => sb.from("sd_my_orders").select(MY_ORDER_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("order_line_id").range(f, t)).then((r) => numify(r, ["final_amount", "total_mrp", "seller_price", "gt_charges"])),
    fetchAll<MySettlementRow>((f, t) => sb.from("sd_my_settlement").select(MY_SETTLE_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, MY_SETTLE_NUM)),
    // Fee history for estimates: the 180 days up to the end of the period.
    fetchAll<MyRateRow>((f, t) => sb.from("sd_my_settlement").select("kind, sku_id, order_date, seller_product_amount, commission, logistics, tax_rate").eq("account_id", account.id).gte("order_date", addDays(to, -179)).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["seller_product_amount", "commission", "logistics", "tax_rate"])),
    fetchAll<MyReturnRow>((f, t) => sb.from("sd_my_returns").select("order_line_id, status, return_reason, sku").eq("account_id", account.id).range(f, t)),
    fetchAll<MyInvoiceRow>((f, t) => sb.from("sd_my_invoices").select("number, charge_month, category, base_amount, total, description").eq("account_id", account.id).order("number").range(f, t)).then((r) => numify(r, ["base_amount", "total"])),
    fetchAll<MyDeductionRow>((f, t) => sb.from("sd_my_deductions").select("invoice_ref, amount, utr, settlement_date, description").eq("account_id", account.id).order("invoice_ref").range(f, t)).then((r) => numify(r, ["amount"])),
    fetchAll<{ sku: string; sku_id: string; style_id: string }>((f, t) => sb.from("sd_my_orders").select("sku, sku_id, style_id").eq("account_id", account.id).order("order_line_id").range(f, t)),
    getFcMaster(account.id),
  ]);
  const [adStyles, styleSkus] = await Promise.all([
    fetchAll<MyAdStyleRow>((f, t) => sb.from("sd_my_ads_styles").select("report_key, report_total, style_id, style_name, spend, clicks, units, revenue").eq("account_id", account.id).order("row_key").range(f, t)).then((r) => numify(r, ["report_total", "spend", "clicks", "units", "revenue"])),
    fetchAll<{ sku: string; asin: string }>((f, t) => sb.from("sd_skus").select("sku, asin").eq("account_id", account.id).eq("fulfillment", "Myntra style").range(f, t)),
  ]);
  const skuOfId = new Map(skuRows.filter((x) => x.sku && x.sku_id).map((x) => [x.sku_id, x.sku]));
  const skuOfStyle = new Map([...styleSkus.map((x) => [x.sku, x.asin] as const), ...skuRows.filter((x) => x.sku && x.style_id).map((x) => [x.style_id, x.sku] as const)]);
  const result = computeMyntra({ orders, settlement, rates, returns, invoices, skuOfId, products: master.products, settings: master.settings, defaults: defaultsOf(account), from, to, adStyles, skuOfStyle });
  return { result, invoices, deductions, master, hasData: orders.length > 0 || settlement.length > 0 };
});

export const getMyStock = cache(async (account: Account, from: string, to: string, days: number) => {
  const sb = await createClient();
  const [orders, master] = await Promise.all([
    fetchAll<MyOrderRow>((f, t) => sb.from("sd_my_orders").select(MY_ORDER_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("order_line_id").range(f, t)),
    getFcMaster(account.id),
  ]);
  // Demand = orders that were not cancelled before shipping.
  const units = new Map<string, number>();
  for (const o of orders) if (!(o.status === "F" && !o.shipped_on && !o.delivered_on) && o.sku) units.set(o.sku, (units.get(o.sku) ?? 0) + 1);
  return computeFcStock({ unitsById: units, periodDays: days, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
});

// ---------- Flipkart ----------
const FK_ORDER_COLS = "order_item_id, order_id, order_date, status, sku, title, quantity, cancelled_on, cancellation_reason, return_reason, dispatched_on, delivered_on";
const FK_SETTLE_COLS = "line_key, order_id, sku, quantity, order_date, neft_id, neft_type, payment_date, settlement_value, sale_amount, offer_amount, my_share, addons, marketplace_fee, commission, fixed_fee, collection_fee, pick_pack_fee, shipping_fee, reverse_shipping_fee, other_fees, tcs, tds, gst_on_fees, offer_adjustment, protection_fund, refund, return_type";
const FK_SETTLE_NUM = ["quantity", "settlement_value", "sale_amount", "offer_amount", "my_share", "addons", "marketplace_fee", "commission", "fixed_fee", "collection_fee", "pick_pack_fee", "shipping_fee", "reverse_shipping_fee", "other_fees", "tcs", "tds", "gst_on_fees", "offer_adjustment", "protection_fund", "refund"];
const FK_SALE_COLS = "order_item_id, order_id, sku, event_sub_type, order_date, quantity, price_before_discount, seller_share, invoice_amount, taxable_value, gst_rate";
const FK_AD_COLS = "grain, period_start, period_end, campaign_id, campaign, sku, product, spend, views, clicks, units, revenue";

export const getFlipkart = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [orders, settlement, rates, sales, returns, ads, master] = await Promise.all([
    fetchAll<FkOrderRow>((f, t) => sb.from("sd_fk_orders").select(FK_ORDER_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("order_item_id").range(f, t)).then((r) => numify(r, ["quantity"])),
    fetchAll<FkSettlementRow>((f, t) => sb.from("sd_fk_settlement").select(FK_SETTLE_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, FK_SETTLE_NUM)),
    // Fee history for estimates: the 90 days up to the end of the period.
    fetchAll<FkRateRow>((f, t) => sb.from("sd_fk_settlement").select("sku, order_date, sale_amount, offer_amount, my_share, marketplace_fee, reverse_shipping_fee, return_type").eq("account_id", account.id).gte("order_date", addDays(to, -89)).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["sale_amount", "offer_amount", "my_share", "marketplace_fee", "reverse_shipping_fee"])),
    fetchAll<FkSaleRow>((f, t) => sb.from("sd_fk_sales").select(FK_SALE_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["quantity", "price_before_discount", "seller_share", "invoice_amount", "taxable_value", "gst_rate"])),
    fetchAll<FkReturnRow>((f, t) => sb.from("sd_fk_returns").select("order_item_id, return_type, status, reason, sub_reason, sku").eq("account_id", account.id).order("return_id").range(f, t)),
    fetchAll<FkAdRow>((f, t) => sb.from("sd_fk_ads").select(FK_AD_COLS).eq("account_id", account.id).lte("period_start", to).gte("period_end", from).order("row_key").range(f, t)).then((r) => numify(r, ["spend", "views", "clicks", "units", "revenue"])),
    getFcMaster(account.id),
  ]);
  const result = computeFlipkart({ orders, settlement, rates, sales, returns, ads, products: master.products, settings: master.settings, defaults: defaultsOf(account), from, to });
  return { result, master, hasData: orders.length > 0 || settlement.length > 0, hasSales: sales.length > 0 };
});

/** Payouts made in the period (by payment date), invoices and deductions, for the Payments tab. */
export const getFkPayments = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [settlement, other, invoices] = await Promise.all([
    fetchAll<FkSettlementRow>((f, t) => sb.from("sd_fk_settlement").select(FK_SETTLE_COLS).eq("account_id", account.id).gte("payment_date", from).lte("payment_date", to).order("row_key").range(f, t)).then((r) => numify(r, FK_SETTLE_NUM)),
    fetchAll<FkOtherRow>((f, t) => sb.from("sd_fk_settlement_other").select("sheet, neft_id, payment_date, type, reference, amount, gst").eq("account_id", account.id).gte("payment_date", from).lte("payment_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["amount", "gst"])),
    fetchAll<{ number: string; doc_type: string; invoice_date: string; original_number: string; ads: number; commission: number; fixed_fee: number; shipping: number; other: number; base_amount: number; gst: number; total: number }>((f, t) => sb.from("sd_fk_invoices").select("number, doc_type, invoice_date, original_number, ads, commission, fixed_fee, shipping, other, base_amount, gst, total").eq("account_id", account.id).order("invoice_date", { ascending: false }).range(f, t))
      .then((r) => numify(r, ["ads", "commission", "fixed_fee", "shipping", "other", "base_amount", "gst", "total"])),
  ]);
  const bySheet = new Map<string, number>();
  for (const o of other) bySheet.set(o.sheet, (bySheet.get(o.sheet) ?? 0) + o.amount);
  return { payouts: fkPayouts(settlement, other), deductions: [...bySheet.entries()].map(([sheet, amount]) => ({ sheet, amount })), invoices };
});

export const getFkStock = cache(async (account: Account, from: string, to: string, days: number) => {
  const sb = await createClient();
  const [orders, master] = await Promise.all([
    fetchAll<FkOrderRow>((f, t) => sb.from("sd_fk_orders").select(FK_ORDER_COLS).eq("account_id", account.id).gte("order_date", from).lte("order_date", to).order("order_item_id").range(f, t)).then((r) => numify(r, ["quantity"])),
    getFcMaster(account.id),
  ]);
  // Demand = orders that were not cancelled before shipping.
  const units = new Map<string, number>();
  for (const o of orders) if (!(o.status === "CANCELLED" && !o.dispatched_on && !o.delivered_on) && o.sku) units.set(o.sku, (units.get(o.sku) ?? 0) + (o.quantity || 1));
  return computeFcStock({ unitsById: units, periodDays: days, products: master.products, settings: master.settings, defaults: defaultsOf(account) });
});

// ---------- Amazon Brand Analytics: Search & listings ----------
const BA_Q_COLS = "period_end, query, volume, impr_total, impr_brand, click_total, click_brand, cart_total, cart_brand, purch_total, purch_brand, price_median, brand_price_median";
const BA_Q_NUM = ["volume", "impr_total", "impr_brand", "click_total", "click_brand", "cart_total", "cart_brand", "purch_total", "purch_brand"];
const BA_A_NUM = ["impressions", "impr_fast", "clicks", "cart_adds", "purchases", "purch_fast", "sales"];

/** Weekly Brand Analytics for one Amazon account. Search terms are read for the first four weeks on record (the
 *  baseline for "what has improved") and the latest twelve (trends and findings); product rows for every week. */
export const getSearch = cache(async (account: Account) => {
  const sb = await createClient();
  const asins = await fetchAll<AsinRow>((f, t) => sb.from("sd_ba_asins").select("period_end, asin, impressions, impr_fast, clicks, cart_adds, purchases, purch_fast, sales, price_median").eq("account_id", account.id).eq("grain", "week").order("period_end").order("asin").range(f, t))
    .then((r) => numify(r, BA_A_NUM).map((x) => ({ ...x, price_median: x.price_median == null ? null : Number(x.price_median) })));
  const { data: qEnds } = await sb.from("sd_ba_queries").select("period_end").eq("account_id", account.id).eq("grain", "week").order("period_end").limit(5000);
  const ends = [...new Set([...asins.map((a) => a.period_end), ...(qEnds ?? []).map((q) => q.period_end as string)])].sort();
  const want = [...new Set([...ends.slice(0, 4), ...ends.slice(-12)])];
  const [queries, basket, products] = await Promise.all([
    want.length ? fetchAll<QueryRow>((f, t) => sb.from("sd_ba_queries").select(BA_Q_COLS).eq("account_id", account.id).eq("grain", "week").in("period_end", want).order("period_end").order("query").range(f, t))
      .then((r) => numify(r, BA_Q_NUM)) : Promise.resolve([] as QueryRow[]),
    fetchAll<BasketRow>((f, t) => sb.from("sd_ba_basket").select("*").eq("account_id", account.id).eq("grain", "month").order("period_end", { ascending: false }).range(f, t))
      .then((r) => numify(r, ["orders", "with_pct_1", "with_pct_2", "with_pct_3"])),
    fetchAll<{ asin: string; title: string; short_name: string }>((f, t) => sb.from("sd_products").select("asin, title, short_name").eq("account_id", account.id).range(f, t)),
  ]);
  const names = new Map(products.map((p) => [p.asin, p.short_name || p.title]));
  const result = computeSearch({ queries, asins, basket, brandName: account.client_name, names });
  return { result, hasData: asins.length > 0 || queries.length > 0, hasQueries: queries.length > 0, hasAsins: asins.length > 0, hasBasket: basket.length > 0 };
});

// ---------- Returns insights (all marketplaces of a brand) ----------
/** Every return and undelivered unit in the period, with the marketplace's reason and the customer's words. */
export const getReturns = cache(async (accounts: Account[], from: string, to: string) => {
  const sb = await createClient();
  const lines: ReturnLine[] = [];
  await Promise.all(accounts.map(async (a) => {
    const [products, skus] = await Promise.all([
      fetchAll<{ asin: string; title: string; short_name: string }>((f, t) => sb.from("sd_products").select("asin, title, short_name").eq("account_id", a.id).range(f, t)),
      fetchAll<{ sku: string; asin: string }>((f, t) => sb.from("sd_skus").select("sku, asin").eq("account_id", a.id).range(f, t)),
    ]);
    const nameMap = new Map(products.map((p) => [p.asin, p.short_name || p.title]));
    const asinOfSku = new Map(skus.map((x) => [x.sku, x.asin]));
    const name = (id: string) => nameMap.get(id) || nameMap.get(asinOfSku.get(id) ?? "") || id;
    if (a.marketplace === "Amazon") {
      const rows = await fetchAll<{ return_date: string; asin: string; sku: string; quantity: number; reason: string; disposition: string; comments: string }>((f, t) => sb.from("sd_returns").select("return_date, asin, sku, quantity, reason, disposition, comments").eq("account_id", a.id).gte("return_date", from).lte("return_date", to).order("row_key").range(f, t));
      for (const r of rows) { const id = r.asin || asinOfSku.get(r.sku) || r.sku; lines.push({ marketplace: "Amazon", date: r.return_date, product: id, name: name(id), quantity: Number(r.quantity) || 1, reason: r.reason, detail: r.disposition, comment: r.comments ?? "" }); }
    } else if (a.marketplace === "FirstCry") {
      const [ret, rto] = await Promise.all([
        fetchAll<{ return_date: string; product_id: string; quantity: number; reason: string; sub_reason: string }>((f, t) => sb.from("sd_fc_returns").select("return_date, product_id, quantity, reason, sub_reason").eq("account_id", a.id).gte("return_date", from).lte("return_date", to).order("row_key").range(f, t)),
        fetchAll<{ return_date: string; product_id: string; rto_qty: number }>((f, t) => sb.from("sd_fc_recon").select("return_date, product_id, rto_qty").eq("account_id", a.id).gt("rto_qty", 0).gte("return_date", from).lte("return_date", to).order("row_key").range(f, t)),
      ]);
      for (const r of ret) lines.push({ marketplace: "FirstCry", date: r.return_date, product: r.product_id, name: name(r.product_id), quantity: Number(r.quantity) || 1, reason: r.reason, detail: r.sub_reason, comment: "" });
      for (const r of rto) lines.push({ marketplace: "FirstCry", date: r.return_date, product: r.product_id, name: name(r.product_id), quantity: Number(r.rto_qty), reason: "RTO", detail: "Returned to origin", comment: "" });
    } else if (a.marketplace === "Myntra") {
      const rows = await fetchAll<{ status: string; sku: string; quantity: number; return_reason: string; return_created_date: string | null; rto_date: string | null }>((f, t) => sb.from("sd_my_returns").select("status, sku, quantity, return_reason, return_created_date, rto_date").eq("account_id", a.id).or(`and(return_created_date.gte.${from},return_created_date.lte.${to}),and(rto_date.gte.${from},rto_date.lte.${to})`).order("row_key").range(f, t));
      for (const r of rows) lines.push({ marketplace: "Myntra", date: (r.rto_date || r.return_created_date)!, product: r.sku, name: name(r.sku), quantity: Number(r.quantity) || 1, reason: r.status === "RTO" ? "RTO" : r.return_reason, detail: r.status, comment: "" });
    } else if (a.marketplace === "Flipkart") {
      const rows = await fetchAll<{ return_type: string; status: string; sku: string; quantity: number; reason: string; sub_reason: string; approved_on: string | null; requested_on: string | null }>((f, t) => sb.from("sd_fk_returns").select("return_type, status, sku, quantity, reason, sub_reason, approved_on, requested_on").eq("account_id", a.id).neq("status", "cancelled").gte("approved_on", from).lte("approved_on", to).order("return_id").range(f, t));
      for (const r of rows) {
        const rto = r.return_type === "courier_return";
        lines.push({ marketplace: "Flipkart", date: (r.approved_on || r.requested_on)!, product: r.sku, name: name(r.sku), quantity: Number(r.quantity) || 1, reason: rto ? "RTO" : r.reason.replace(/_/g, " "), detail: rto ? `Returned to origin: ${r.reason.replace(/_/g, " ")}` : r.sub_reason.replace(/_/g, " "), comment: "" });
      }
    }
  }));
  return computeReturns(lines);
});

// ---------- Pexeta's work for a brand (client-visible Ops tasks) ----------
export type WorkItem = { ref: number; title: string; marketplace: string; state: "completed" | "in_progress" | "waiting"; need: string; due_date: string; done_at: string | null; updated_at: string };
/** Waiting on the seller and in progress: all open items. Completed: closed by the VP within the dates. */
export const getClientWork = cache(async (clientId: string, from: string, to: string) => {
  const sb = await createClient();
  const { data, error } = await sb.rpc("sd_client_tasks", { p_client: clientId });
  if (error) return { waiting: [] as WorkItem[], inProgress: [] as WorkItem[], completed: [] as WorkItem[], available: false };
  const rows = (data ?? []) as WorkItem[];
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const byDue = (a: WorkItem, b: WorkItem) => a.due_date.localeCompare(b.due_date);
  return {
    waiting: rows.filter((r) => r.state === "waiting").sort(byDue),
    inProgress: rows.filter((r) => r.state === "in_progress").sort(byDue),
    completed: rows.filter((r) => r.state === "completed" && day(r.done_at) >= from && day(r.done_at) <= to).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")),
    available: true,
  };
});

// ---------- Returns in rupees, and Amazon reimbursement checks ----------
const REFUND_COLS = "posted_date, order_id, sku, asin, quantity, description, fulfillment, product_sales, shipping_credits, gift_wrap_credits, promotional_rebates, tax_liable, selling_fees, fba_fees, other_transaction_fees, total";
const REFUND_NUM = ["quantity", "product_sales", "shipping_credits", "gift_wrap_credits", "promotional_rebates", "tax_liable", "selling_fees", "fba_fees", "other_transaction_fees", "total"];
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export const getReturnsMoney = cache(async (accounts: Account[], from: string, to: string) => {
  const sb = await createClient();
  const amazon = accounts.find((a) => a.marketplace === "Amazon");
  const firstcry = accounts.find((a) => a.marketplace === "FirstCry");
  const myntra = accounts.find((a) => a.marketplace === "Myntra");

  let refunds: RefundRow[] = [], reimbursementsInPeriod: ReimbRow[] = [];
  const orderFees: FeeRow[] = [], reimbursements: ReimbRow[] = [], amazonReturns: AmzReturnRow[] = [];
  let costPerUnit = (_sku: string, _asin: string, price: number) => price * 0.25;
  let nameOf = (asin: string, sku: string) => asin || sku;
  let asOf = to;
  if (amazon) {
    const id = amazon.id;
    [refunds, reimbursementsInPeriod] = await Promise.all([
      fetchAll<RefundRow>((f, t) => sb.from("sd_transactions").select(REFUND_COLS).eq("account_id", id).eq("type", "Refund").gte("posted_date", from).lte("posted_date", to).order("row_hash").range(f, t)).then((r) => numify(r, REFUND_NUM)),
      fetchAll<ReimbRow>((f, t) => sb.from("sd_transactions").select("posted_date, order_id, sku, description, quantity, total").eq("account_id", id).ilike("description", "%reimburs%").gte("posted_date", from).lte("posted_date", to).order("row_hash").range(f, t)).then((r) => numify(r, ["quantity", "total"])),
    ]);
    // The Reimbursements report, when uploaded, is the complete record of what Amazon paid: use it for
    // "recovered in these dates", and to match refunded orders that were already reimbursed.
    const report = await fetchAll<ReimbursementRow>((f, t) => sb.from("sd_reimbursements").select("approval_date, reimbursement_id, order_id, reason, sku, fnsku, asin, condition, amount_per_unit, amount_total, qty_cash, qty_inventory, qty_total").eq("account_id", id).gte("approval_date", from).lte("approval_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["amount_per_unit", "amount_total", "qty_cash", "qty_inventory", "qty_total"]));
    if (report.length) reimbursementsInPeriod = report.map((r) => ({ posted_date: r.approval_date, order_id: r.order_id, sku: r.sku, description: `FBA reimbursement: ${reimbursementReason(r.reason)}`, quantity: r.qty_total, total: r.amount_total }));
    const orders = [...new Set(refunds.map((r) => r.order_id).filter(Boolean))];
    for (const part of chunks(orders)) {
      const [fees, reimb, rets] = await Promise.all([
        fetchAll<FeeRow>((f, t) => sb.from("sd_transactions").select("order_id, sku, selling_fees, fba_fees, other_transaction_fees").eq("account_id", id).eq("type", "Order").in("order_id", part).order("row_hash").range(f, t)).then((r) => numify(r, ["selling_fees", "fba_fees", "other_transaction_fees"])),
        fetchAll<ReimbRow>((f, t) => sb.from("sd_transactions").select("posted_date, order_id, sku, description, quantity, total").eq("account_id", id).ilike("description", "%reimburs%").in("order_id", part).order("row_hash").range(f, t)).then((r) => numify(r, ["quantity", "total"])),
        fetchAll<AmzReturnRow>((f, t) => sb.from("sd_returns").select("return_date, order_id, sku, asin, quantity, disposition, reason").eq("account_id", id).in("order_id", part).order("row_key").range(f, t)).then((r) => numify(r, ["quantity"])),
      ]);
      const rep = await fetchAll<{ approval_date: string; order_id: string; sku: string; reason: string; qty_total: number; amount_total: number }>((f, t) => sb.from("sd_reimbursements").select("approval_date, order_id, sku, reason, qty_total, amount_total").eq("account_id", id).in("order_id", part).order("row_key").range(f, t)).then((r) => numify(r, ["qty_total", "amount_total"]));
      orderFees.push(...fees); reimbursements.push(...reimb, ...rep.map((r) => ({ posted_date: r.approval_date, order_id: r.order_id, sku: r.sku, description: `reimbursement ${r.reason}`, quantity: r.qty_total, total: r.amount_total }))); amazonReturns.push(...rets);
    }
    const [settings, products, latest] = await Promise.all([
      fetchAll<ProductSetting>((f, t) => sb.from("sd_product_settings").select("asin, cost_pct, cost_per_unit, lead_time_days, warehouse_stock").eq("account_id", id).range(f, t)),
      fetchAll<{ asin: string; title: string; short_name: string }>((f, t) => sb.from("sd_products").select("asin, title, short_name").eq("account_id", id).range(f, t)),
      latestDataDate(id),
    ]);
    const set = new Map(settings.map((x) => [x.asin, x]));
    const names = new Map(products.map((p) => [p.asin, p.short_name || p.title]));
    // Product cost: the seller's rupees per unit, else their %, else the account default %, of the price refunded.
    costPerUnit = (_sku, asin, price) => { const s = set.get(asin); if (s?.cost_per_unit != null) return Number(s.cost_per_unit); return price * Number(s?.cost_pct ?? amazon.default_cost_pct); };
    nameOf = (asin, sku) => names.get(asin) || sku || asin;
    asOf = latest ?? to;
  }
  const fc = firstcry ? await fetchAll<{ rto_total: number; sr_total: number; rto_qty: number; sr_qty: number }>((f, t) => sb.from("sd_fc_recon").select("rto_total, sr_total, rto_qty, sr_qty").eq("account_id", firstcry.id).gte("return_date", from).lte("return_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["rto_total", "sr_total", "rto_qty", "sr_qty"])) : null;
  const myReverse = myntra ? await fetchAll<{ expected_settled: number; logistics: number }>((f, t) => sb.from("sd_my_settlement").select("expected_settled, logistics").eq("account_id", myntra.id).eq("kind", "reverse").gte("order_date", from).lte("order_date", to).order("row_key").range(f, t)).then((r) => numify(r, ["expected_settled", "logistics"])) : null;

  const money = computeReturnsMoney({ refunds, orderFees, reimbursements, reimbursementsInPeriod, amazonReturns, costPerUnit, nameOf, asOf, fc, myReverse });
  const warehouse = amazon ? await getWarehouseClaims(amazon, from, to) : null;
  if (warehouse) {
    money.warehouse = warehouse;
    // "To check" (carrier damage on the way in) is left out of the total until the team confirms it.
    money.total.recoverable += warehouse.claimable + warehouse.pending;
  }
  return money;
});

// ---------- Amazon: stock lost or damaged in Amazon's warehouses ----------
export const getWarehouseClaims = cache(async (account: Account, from: string, to: string) => {
  const sb = await createClient();
  const [ledger, reimbursements, products, latest] = await Promise.all([
    fetchAll<LedgerRow>((f, t) => sb.from("sd_inv_ledger").select("event_date, event_type, fnsku, asin, sku, reference_id, quantity, fc, disposition, reason, reconciled, unreconciled").eq("account_id", account.id).in("event_type", ["Adjustments", "Receipts"]).order("event_date").order("row_key").range(f, t)).then((r) => numify(r, ["quantity", "reconciled", "unreconciled"])),
    fetchAll<ReimbursementRow>((f, t) => sb.from("sd_reimbursements").select("approval_date, reimbursement_id, order_id, reason, sku, fnsku, asin, condition, amount_per_unit, amount_total, qty_cash, qty_inventory, qty_total").eq("account_id", account.id).order("row_key").range(f, t)).then((r) => numify(r, ["amount_per_unit", "amount_total", "qty_cash", "qty_inventory", "qty_total"])),
    fetchAll<{ asin: string; title: string; short_name: string }>((f, t) => sb.from("sd_products").select("asin, title, short_name").eq("account_id", account.id).range(f, t)),
    latestDataDate(account.id),
  ]);
  if (!ledger.length && !reimbursements.length) return null;
  const asOf = [latest ?? to, ...ledger.map((l) => l.event_date)].sort().pop()!;
  // Average selling price incl. GST over the last 90 days, for products Amazon has never reimbursed.
  const sales = await fetchAll<{ sku: string; quantity: number; product_sales: number; tax_liable: number }>((f, t) => sb.from("sd_transactions").select("sku, quantity, product_sales, tax_liable").eq("account_id", account.id).eq("type", "Order").gte("posted_date", addDays(asOf, -90)).lte("posted_date", asOf).order("row_hash").range(f, t)).then((r) => numify(r, ["quantity", "product_sales", "tax_liable"]));
  const price = new Map<string, { v: number; q: number }>();
  for (const x of sales) if (x.quantity > 0) { const p = price.get(x.sku) ?? { v: 0, q: 0 }; p.v += x.product_sales + x.tax_liable; p.q += x.quantity; price.set(x.sku, p); }
  const names = new Map(products.map((p) => [p.asin, p.short_name || p.title]));
  return computeWarehouseClaims({
    ledger, reimbursements, from, to, asOf,
    sellingPrice: (sku) => { const p = price.get(sku); return p && p.q ? p.v / p.q : null; },
    nameOf: (asin, sku) => names.get(asin) || sku || asin,
  });
});
