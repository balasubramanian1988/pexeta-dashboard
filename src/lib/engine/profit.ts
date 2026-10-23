// Profit by product (ASIN) from Amazon's own figures. Same method as the Root and Soil workbook of 23 Oct 2026:
//  - Net sales = product sales + shipping + gift wrap credits + promotional rebates (all excl. GST), orders and refunds.
//  - Amazon fees = selling + FBA + other transaction fees, Easy Ship charges and fee refunds, matched by SKU or order ID.
//    Amazon reports fees including 18% GST, which the seller claims back, so fees are divided by 1.18.
//  - Ad spend = SP and SD spend per ASIN; Sponsored Brands spend (not reported per ASIN) is the rest of Amazon's
//    Cost of Advertising charge (÷1.18), split by each ASIN's share of SB attributed sales. If Amazon's charge
//    is missing for the period, ads reports alone are used and SB spend is split the same way.
//  - Product cost = seller's cost per unit, else seller's cost %, else the account default %, of the
//    average GST-inclusive selling price, times net units.
import type { AccountDefaults, AdRow, ProductRow, ProductSetting, SbPurchaseRow, SkuRow, TxnRow } from "./types";

export const FEE_GST = 1.18;

export type ProfitRow = {
  asin: string;
  name: string;
  unitsSold: number;
  unitsRefunded: number;
  units: number;
  avgPriceInclGst: number;
  netSales: number;
  grossSales: number;
  promotions: number;
  refunds: number;
  fees: number;          // positive = cost, excl. GST
  ads: number;           // excl. GST
  adSales: number;       // attributed ad sales (for ACoS)
  reimbursements: number;
  costPerUnit: number;
  costSource: "seller_rupees" | "seller_pct" | "default";
  productCost: number;
  profit: number;
  margin: number;
  gstOnSales: number;
};

export type ProfitResult = {
  rows: ProfitRow[];
  totals: Omit<ProfitRow, "asin" | "name" | "avgPriceInclGst" | "costPerUnit" | "costSource" | "margin"> & { margin: number };
  accountLevel: { label: string; amount: number }[]; // excl. GST where it is a fee
  accountLevelTotal: number;
  profitAfterAccountLevel: number;
  marginAfterAccountLevel: number;
  ads: { amazonChargeExGst: number; spSd: number; sbResidual: number; source: "amazon_charge" | "ads_reports" };
  tcs: number;
  tds: number;
  payouts: number;
};

const AD_CHARGE = (t: TxnRow) => t.type === "Service Fee" && /Cost of Advertising/i.test(t.description);

export function computeProfit(args: {
  txns: TxnRow[];
  ads: AdRow[];
  sbPurchases: SbPurchaseRow[];
  skus: SkuRow[];
  products: ProductRow[];
  settings: ProductSetting[];
  defaults: AccountDefaults;
}): ProfitResult {
  const { txns, ads, sbPurchases, skus, products, settings, defaults } = args;
  const skuAsin = new Map(skus.map((s) => [s.sku, s.asin]));
  const orderSku = new Map<string, string>();
  for (const t of txns) if (t.type === "Order" && t.sku && t.order_id && !orderSku.has(t.order_id)) orderSku.set(t.order_id, t.sku);
  // Unified report descriptions are the product title cut to 150 characters: the last resort for unknown SKUs.
  const titles = products.filter((p) => p.title).map((p) => [p.title.toLowerCase(), p.asin] as const);
  const byTitle = (d: string) => {
    const k = d.toLowerCase().trim();
    if (k.length < 20) return "";
    return titles.find(([t]) => t.startsWith(k) || k.startsWith(t))?.[1] ?? "";
  };
  const asinOf = (t: TxnRow) => {
    const sku = t.sku || (t.order_id ? orderSku.get(t.order_id) ?? "" : "");
    const hit = sku ? skuAsin.get(sku) ?? skuAsin.get(sku.replace(/[-_ ]*FBA(-\d+)*$/i, "")) : undefined;
    return hit ?? (t.type === "Order" || t.type === "Refund" ? byTitle(t.description) : "");
  };

  type Acc = { sold: number; refunded: number; sales: number; promos: number; refunds: number; feesIncl: number; reimb: number; gst: number; orderSalesInclGst: number; orderQty: number };
  const acc = new Map<string, Acc>();
  const get = (a: string) => {
    let x = acc.get(a);
    if (!x) acc.set(a, (x = { sold: 0, refunded: 0, sales: 0, promos: 0, refunds: 0, feesIncl: 0, reimb: 0, gst: 0, orderSalesInclGst: 0, orderQty: 0 }));
    return x;
  };
  const account: Record<string, number> = {};
  const addAccount = (label: string, v: number) => (account[label] = (account[label] ?? 0) + v);
  let amazonAdChargeIncl = 0, tcs = 0, tds = 0, payouts = 0;

  for (const t of txns) {
    tcs += t.tcs_cgst + t.tcs_sgst + t.tcs_igst;
    tds += t.tds;
    if (t.type === "Transfer") { payouts += -t.total; continue; }
    if (AD_CHARGE(t)) { amazonAdChargeIncl += -t.total; continue; }
    const asin = asinOf(t);
    const fees = t.selling_fees + t.fba_fees + t.other_transaction_fees;
    if (t.type === "Order" || t.type === "Refund") {
      if (!asin) { addAccount("Sales not matched to a product", t.product_sales + t.shipping_credits + t.gift_wrap_credits + t.promotional_rebates + fees / FEE_GST); continue; }
      const a = get(asin);
      const lineSales = t.product_sales + t.shipping_credits + t.gift_wrap_credits;
      a.sales += lineSales;
      a.promos += t.promotional_rebates;
      a.feesIncl += fees;
      a.gst += t.tax_liable;
      if (t.type === "Order") { a.sold += t.quantity; a.orderSalesInclGst += t.product_sales + t.tax_liable; a.orderQty += t.quantity; }
      else { a.refunded += t.quantity; a.refunds += -lineSales; }
      continue;
    }
    const isFeeLike = ["Shipping Services", "Fulfilment Fee Refund", "Fulfillment Fee Refund", "FBA Transaction fees", "Service Fee"].includes(t.type);
    if (isFeeLike) {
      const v = fees + t.other;
      if (asin && t.type !== "Service Fee" && t.type !== "FBA Transaction fees") get(asin).feesIncl += v;
      else addAccount(t.description || t.type, v / FEE_GST);
      continue;
    }
    if (t.type === "Adjustment" || t.type === "Reimbursements") {
      const v = t.total;
      if (asin) get(asin).reimb += v;
      else addAccount(t.description || t.type, v);
      continue;
    }
    addAccount(t.description || t.type, t.total);
  }

  // ---- Ads ----
  const spSd = new Map<string, number>();
  const adSales = new Map<string, number>();
  let spSdTotal = 0, sbReported = 0;
  for (const a of ads) {
    if (a.ad_type === "SB") { sbReported += a.spend; continue; }
    if (!a.asin) continue;
    spSd.set(a.asin, (spSd.get(a.asin) ?? 0) + a.spend);
    adSales.set(a.asin, (adSales.get(a.asin) ?? 0) + a.sales);
    spSdTotal += a.spend;
  }
  const amazonChargeExGst = amazonAdChargeIncl / FEE_GST;
  const source = amazonAdChargeIncl > 0 ? "amazon_charge" : "ads_reports";
  const sbResidual = source === "amazon_charge" ? Math.max(0, amazonChargeExGst - spSdTotal) : sbReported;
  const sbSales = new Map<string, number>();
  let sbSalesTotal = 0;
  for (const p of sbPurchases) { sbSales.set(p.asin, (sbSales.get(p.asin) ?? 0) + p.sales); sbSalesTotal += p.sales; adSales.set(p.asin, (adSales.get(p.asin) ?? 0) + p.sales); }
  const adOf = (asin: string) => (spSd.get(asin) ?? 0) + (sbSalesTotal > 0 ? (sbResidual * (sbSales.get(asin) ?? 0)) / sbSalesTotal : 0);
  // Ad spend on ASINs with no sales in the period still counts, at account level.
  for (const asin of new Set([...spSd.keys(), ...sbSales.keys()])) if (!acc.has(asin)) addAccount("Ad spend on products with no sales", adOf(asin));
  if (sbSalesTotal === 0 && sbResidual > 0) addAccount("Sponsored Brands spend (no purchase data to split it)", sbResidual);

  // ---- Rows ----
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const name = new Map(products.map((p) => [p.asin, p.short_name || p.title || p.asin]));
  const rows: ProfitRow[] = [];
  for (const [asin, a] of acc) {
    const units = a.sold - a.refunded;
    const netSales = a.sales + a.promos;
    const avg = a.orderQty > 0 ? a.orderSalesInclGst / a.orderQty : 0;
    const s = setting.get(asin);
    let costPerUnit: number, costSource: ProfitRow["costSource"];
    if (s?.cost_per_unit != null) { costPerUnit = Number(s.cost_per_unit); costSource = "seller_rupees"; }
    else if (s?.cost_pct != null) { costPerUnit = Number(s.cost_pct) * avg; costSource = "seller_pct"; }
    else { costPerUnit = defaults.default_cost_pct * avg; costSource = "default"; }
    const fees = -a.feesIncl / FEE_GST;
    const adsCost = adOf(asin);
    const productCost = costPerUnit * units;
    const profit = netSales - fees - adsCost - productCost + a.reimb;
    rows.push({
      asin, name: name.get(asin) ?? asin,
      unitsSold: a.sold, unitsRefunded: a.refunded, units, avgPriceInclGst: avg,
      netSales, grossSales: a.sales + a.refunds, promotions: a.promos, refunds: a.refunds,
      fees, ads: adsCost, adSales: adSales.get(asin) ?? 0, reimbursements: a.reimb,
      costPerUnit, costSource, productCost, profit, margin: netSales ? profit / netSales : 0, gstOnSales: a.gst,
    });
  }
  rows.sort((x, y) => y.netSales - x.netSales);

  const sum = (k: keyof ProfitRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const totals = {
    unitsSold: sum("unitsSold"), unitsRefunded: sum("unitsRefunded"), units: sum("units"),
    netSales: sum("netSales"), grossSales: sum("grossSales"), promotions: sum("promotions"), refunds: sum("refunds"),
    fees: sum("fees"), ads: sum("ads"), adSales: sum("adSales"), reimbursements: sum("reimbursements"),
    productCost: sum("productCost"), profit: sum("profit"), gstOnSales: sum("gstOnSales"), margin: 0,
  };
  totals.margin = totals.netSales ? totals.profit / totals.netSales : 0;
  const accountLevel = Object.entries(account).map(([label, amount]) => ({ label, amount })).filter((x) => Math.abs(x.amount) > 0.005);
  const accountLevelTotal = accountLevel.reduce((s, x) => s + x.amount, 0);
  const profitAfterAccountLevel = totals.profit + accountLevelTotal;
  return {
    rows, totals, accountLevel, accountLevelTotal, profitAfterAccountLevel,
    marginAfterAccountLevel: totals.netSales ? profitAfterAccountLevel / totals.netSales : 0,
    ads: { amazonChargeExGst, spSd: spSdTotal, sbResidual, source },
    tcs: -tcs, tds: -tds, payouts,
  };
}
