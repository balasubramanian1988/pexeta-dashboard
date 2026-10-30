// Myntra (PPMP marketplace, seller ships) calculations. Pure functions, so they run in tests too.
//
// How Myntra pays (Root and Soil's settlement files, Sep 2026):
//   customer price (MRP − seller discount)                       e.g. ₹1,093
//   − Myntra's margin ("gt charges")                              ₹171
//   = seller product amount: the seller's invoice, incl. GST      ₹922
//   − commission (0 / 2.36 / 4.72 % incl. GST) − fixed fee and shipping (incl. GST) − TCS − TDS
//   = settled amount                                              ₹903.75
// Customer returns take back the seller product amount and add reverse shipping. RTOs earn nothing and carry no
// charges in the settlement files. Ads are billed separately on "Marketing Claim" invoices.
//
//   sales (excl. GST)    = customer price ÷ (1 + GST rate)        – comparable with Amazon's net sales
//   revenue (excl. GST)  = seller product amount ÷ (1 + GST rate) – what the seller invoices
//   fees (excl. GST)     = (commission + fixed fee + shipping) ÷ 1.18
//   profit               = revenue − fees − product cost − ads
//   TCS and TDS are tax credits the seller claims back, so they are not costs.
// Orders not yet in a settlement file are estimated from the orders report (seller price) and the product's latest fees.
import type { AccountDefaults, ProductSetting } from "./types";

export type MyOrderRow = {
  order_line_id: string; order_release_id: string; order_date: string; sku: string; sku_id: string; style_name: string;
  status: string; cancellation_reason: string; final_amount: number; total_mrp: number; seller_price: number; gt_charges: number;
  shipped_on: string | null; delivered_on: string | null; rto_date: string | null;
};
export type MySettlementRow = {
  kind: "forward" | "reverse"; order_line_id: string; order_date: string; sku_id: string;
  customer_paid: number; seller_product_amount: number; commission: number; logistics: number; tcs: number; tds: number;
  tax_rate: number; expected_settled: number; settled: number; settlement_date: string | null;
  settled_postpaid: number; utr_postpaid: string | null; date_postpaid: string | null;
  settled_prepaid: number; utr_prepaid: string | null; date_prepaid: string | null;
};
export type MyRateRow = { sku_id: string; order_date: string; seller_product_amount: number; commission: number; logistics: number; tax_rate: number; kind: string };
export type MyReturnRow = { order_line_id: string; status: string; return_reason: string; sku: string };
export type MyInvoiceRow = { number: string; charge_month: string; category: string; base_amount: number; total: number; description: string };
export type MyDeductionRow = { invoice_ref: string; amount: number; utr: string | null; settlement_date: string | null; description: string };
export type MyProduct = { asin: string; title: string; short_name: string };
export type MyAdStyleRow = { report_key: string; report_total: number; style_id: string; style_name: string; spend: number; clicks: number; units: number; revenue: number };

export type MyLineStatus = "settled" | "pending_settlement" | "not_in_settlement" | "returned" | "rto" | "cancelled";
export const MY_STATUS_LABEL: Record<MyLineStatus, string> = {
  settled: "Paid",
  pending_settlement: "In settlement file, not yet paid",
  not_in_settlement: "Not yet in a settlement file (estimated)",
  returned: "Customer return",
  rto: "Not delivered (RTO)",
  cancelled: "Cancelled before shipping",
};

export type MyProductRow = {
  sku: string; name: string;
  orders: number; units: number; returnUnits: number; rtoUnits: number; cancelled: number;
  sales: number; revenue: number; myntraMargin: number; fees: number; productCost: number;
  estimated: number; profit: number; margin: number; costPerUnit: number;
  avgPrice: number;          // customer price incl. GST, average over units sold
  ads: number;               // this period's share of ads invoices, split by the linked ads-by-style report
};

export type MyResult = {
  rows: MyProductRow[];
  totals: {
    orders: number; units: number; returnUnits: number; rtoUnits: number; cancelled: number; shipped: number;
    sales: number; revenue: number; myntraMargin: number; fees: number; productCost: number; ads: number;
    estimated: number; estimatedLines: number; profit: number; margin: number; rtoRate: number; returnRate: number;
  };
  status: Record<MyLineStatus, { lines: number; amount: number }>;  // amount = payout incl. GST (estimated where not settled)
  utrs: { utr: string; date: string | null; amount: number; lines: number }[];
  ads: { number: string; month: string; base: number; inPeriod: number; report: string | null; description: string }[];
  adStyles: { styleId: string; sku: string; name: string; spend: number; inPeriod: number; units: number; revenue: number; roas: number }[];
  unmatchedAdReports: { reportKey: string; total: number; styles: number }[];
  adsUnallocated: number;
  reasons: { reason: string; kind: "Return" | "RTO / cancelled"; count: number }[];
  daily: { date: string; sales: number; units: number }[];
};

const FEE_GST = 1.18;
const exGst = (v: number, rate: number) => v / (1 + (rate || 0) / 100);
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Ads billed for a month, spread evenly over its days; the share that falls inside [from, to]. */
export function adsInPeriod(invoices: MyInvoiceRow[], from: string, to: string) {
  return invoices.filter((i) => i.category === "Ads").map((i) => {
    const m = i.charge_month.slice(0, 7), n = daysIn(m);
    const start = `${m}-01`, end = `${m}-${String(n).padStart(2, "0")}`;
    const a = from > start ? from : start, b = to < end ? to : end;
    const days = a <= b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : 0;
    return { number: i.number, month: i.charge_month, base: i.base_amount, inPeriod: (i.base_amount * days) / n };
  });
}

export function computeMyntra(args: {
  orders: MyOrderRow[]; settlement: MySettlementRow[]; rates: MyRateRow[]; returns: MyReturnRow[];
  invoices: MyInvoiceRow[]; skuOfId: Map<string, string>; products: MyProduct[]; settings: ProductSetting[];
  defaults: AccountDefaults; from: string; to: string;
  adStyles?: MyAdStyleRow[]; skuOfStyle?: Map<string, string>;
}): MyResult {
  const { orders, settlement, rates, returns, invoices, skuOfId, products, settings, defaults, from, to } = args;
  const adStyleRows = args.adStyles ?? [], skuOfStyle = args.skuOfStyle ?? new Map<string, string>();
  const product = new Map(products.map((p) => [p.asin, p]));
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const fwd = new Map(settlement.filter((s) => s.kind === "forward").map((s) => [s.order_line_id, s]));
  const rev = new Map(settlement.filter((s) => s.kind === "reverse").map((s) => [s.order_line_id, s]));
  const retByLine = new Map(returns.map((r) => [r.order_line_id + "|" + r.status, r]));

  // Latest fees and GST rate per Myntra SKU id, and an account-wide fee ratio, for estimates.
  const latest = new Map<string, MyRateRow>();
  let feeSum = 0, spSum = 0;
  for (const r of rates) {
    if (r.kind !== "forward" || r.seller_product_amount <= 0) continue;
    const x = latest.get(r.sku_id);
    if (!x || r.order_date >= x.order_date) latest.set(r.sku_id, r);
    feeSum += r.commission + r.logistics; spSum += r.seller_product_amount;
  }
  const feeRatio = spSum ? feeSum / spSum : 0;
  const gstOf = (skuId: string) => latest.get(skuId)?.tax_rate ?? 18;
  const unitCost = (sku: string, priceInclGst: number) => {
    const s = setting.get(sku);
    if (s?.cost_per_unit != null) return Number(s.cost_per_unit);
    return (s?.cost_pct != null ? Number(s.cost_pct) : defaults.default_cost_pct) * priceInclGst;
  };

  type Acc = Omit<MyProductRow, "name" | "margin" | "profit" | "costPerUnit" | "avgPrice"> & { lastPrice: number; priceSum: number };
  const acc = new Map<string, Acc>();
  const get = (sku: string) => {
    let a = acc.get(sku);
    if (!a) { a = { sku, orders: 0, units: 0, returnUnits: 0, rtoUnits: 0, cancelled: 0, sales: 0, revenue: 0, myntraMargin: 0, fees: 0, productCost: 0, estimated: 0, ads: 0, lastPrice: 0, priceSum: 0 }; acc.set(sku, a); }
    return a;
  };
  const status = Object.fromEntries(Object.keys(MY_STATUS_LABEL).map((k) => [k, { lines: 0, amount: 0 }])) as MyResult["status"];
  const daily = new Map<string, { sales: number; units: number }>();
  const reasonCount = new Map<string, { reason: string; kind: "Return" | "RTO / cancelled"; count: number }>();
  const reason = (r: string, kind: "Return" | "RTO / cancelled") => { if (!r) return; const k = kind + r; const x = reasonCount.get(k) ?? { reason: r, kind, count: 0 }; x.count++; reasonCount.set(k, x); };
  let estimatedLines = 0;

  // Every order line in the period: from the orders report, plus settled lines whose order report was not uploaded.
  const lines = new Map<string, { o?: MyOrderRow; date: string; sku: string }>();
  for (const o of orders) lines.set(o.order_line_id, { o, date: o.order_date, sku: o.sku || skuOfId.get(o.sku_id) || o.sku_id });
  for (const s of settlement) if (!lines.has(s.order_line_id)) lines.set(s.order_line_id, { date: s.order_date, sku: skuOfId.get(s.sku_id) || s.sku_id });

  for (const [line, { o, date, sku }] of lines) {
    const a = get(sku);
    a.orders++;
    const f = fwd.get(line), r = rev.get(line);
    const shipped = !!(o?.shipped_on || o?.delivered_on || f);
    const isRto = !f && (o?.status === "RTO" || retByLine.has(line + "|RTO") || (o?.status === "F" && shipped));
    if (o && o.status === "F" && !shipped) { a.cancelled++; status.cancelled.lines++; reason(o.cancellation_reason, "RTO / cancelled"); continue; }
    if (isRto) { a.rtoUnits++; status.rto.lines++; reason(o?.cancellation_reason || "RTO", "RTO / cancelled"); continue; }

    // A sale (delivered, or on its way).
    const skuId = o?.sku_id ?? "";
    const rate = f?.tax_rate ?? gstOf(skuId);
    const price = f?.customer_paid ?? o?.final_amount ?? 0;
    const sp = f?.seller_product_amount ?? o?.seller_price ?? 0;
    const feesIncl = f ? f.commission + f.logistics : (latest.get(skuId) ? latest.get(skuId)!.commission + latest.get(skuId)!.logistics : feeRatio * sp);
    const sales = exGst(price, rate), revenue = exGst(sp, rate);
    a.units++; a.lastPrice = price || a.lastPrice; a.priceSum += price;
    a.sales += sales; a.revenue += revenue; a.myntraMargin += sales - revenue; a.fees += feesIncl / FEE_GST;
    a.productCost += unitCost(sku, price);
    if (!f) { a.estimated += revenue - feesIncl / FEE_GST; estimatedLines++; }
    const d = daily.get(date) ?? { sales: 0, units: 0 }; d.sales += sales; d.units++; daily.set(date, d);

    // Customer return: settlement reverse row when Myntra has charged it, else the returns report (estimated).
    const returned = r || retByLine.get(line + "|Return");
    if (returned) {
      const rsp = r ? r.seller_product_amount : sp, rprice = r ? r.customer_paid : price;
      const rfees = r ? r.commission + r.logistics : (f ? f.logistics : feesIncl); // estimate: shipping back costs about the same
      a.returnUnits++;
      a.sales -= exGst(rprice, rate); a.revenue -= exGst(rsp, rate); a.myntraMargin -= exGst(rprice, rate) - exGst(rsp, rate);
      a.fees += rfees / FEE_GST;
      if (!r) a.estimated -= exGst(rsp, rate) + rfees / FEE_GST;
      d.sales -= exGst(rprice, rate);
      status.returned.lines++; status.returned.amount += (r?.settled ?? 0) + (f?.settled ?? 0);
      reason(retByLine.get(line + "|Return")?.return_reason || "Not given", "Return");
      continue;
    }
    if (f && f.settled) { status.settled.lines++; status.settled.amount += f.settled; }
    else if (f) { status.pending_settlement.lines++; status.pending_settlement.amount += f.expected_settled; }
    else { status.not_in_settlement.lines++; status.not_in_settlement.amount += sp - feesIncl; }
  }

  // Ads: each month's invoice, split across products by the ads-by-style report whose total spend matches it.
  const reports = new Map<string, MyAdStyleRow[]>();
  for (const r of adStyleRows) reports.set(r.report_key, [...(reports.get(r.report_key) ?? []), r]);
  const adInv = new Map(invoices.filter((i) => i.category === "Ads").map((i) => [i.number, i]));
  const used = new Set<string>();
  const linkOf = (base: number) => [...reports.entries()].find(([k, rows]) => !used.has(k) && Math.abs(rows[0].report_total - base) <= 1)?.[0] ?? null;
  const ads = adsInPeriod(invoices, from, to).map((a) => {
    const report = linkOf(a.base);
    if (report) used.add(report);
    return { ...a, report, description: adInv.get(a.number)?.description ?? "" };
  });
  const adTotal = ads.reduce((s, x) => s + x.inPeriod, 0);
  const styleAgg = new Map<string, MyResult["adStyles"][number]>();
  let adsUnallocated = 0;
  for (const a of ads) {
    const rows = a.report ? reports.get(a.report)! : [];
    const total = rows.reduce((s, r) => s + r.spend, 0);
    if (!total) { adsUnallocated += a.inPeriod; continue; }
    for (const r of rows) {
      const share = (a.inPeriod * r.spend) / total, frac = a.base ? a.inPeriod / a.base : 0;
      const sku = skuOfStyle.get(r.style_id) ?? "";
      const x = styleAgg.get(r.style_id) ?? { styleId: r.style_id, sku, name: r.style_name, spend: 0, inPeriod: 0, units: 0, revenue: 0, roas: 0 };
      x.spend += r.spend * frac; x.inPeriod += share; x.units += r.units * frac; x.revenue += r.revenue * frac;
      styleAgg.set(r.style_id, x);
      if (sku) get(sku).ads += share; else adsUnallocated += share;
    }
  }
  const adStyles = [...styleAgg.values()].map((x) => ({ ...x, roas: x.inPeriod ? x.revenue / x.inPeriod : 0 })).sort((a, b) => b.inPeriod - a.inPeriod);
  const unmatchedAdReports = [...reports.entries()].filter(([k]) => !used.has(k)).map(([k, rows]) => ({ reportKey: k, total: rows[0].report_total, styles: rows.length }));
  const rows: MyProductRow[] = [...acc.values()].map((a) => {
    const profit = a.revenue - a.fees - a.productCost - a.ads;
    const p = product.get(a.sku);
    const { priceSum, lastPrice, ...rest } = a;
    return { ...rest, name: p?.short_name || p?.title || a.sku, profit, margin: a.sales ? profit / a.sales : 0, costPerUnit: unitCost(a.sku, lastPrice), avgPrice: a.units ? priceSum / a.units : 0 };
  }).sort((x, y) => y.sales - x.sales);
  const sum = (k: keyof MyProductRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const t = {
    orders: sum("orders"), units: sum("units"), returnUnits: sum("returnUnits"), rtoUnits: sum("rtoUnits"), cancelled: sum("cancelled"),
    sales: sum("sales"), revenue: sum("revenue"), myntraMargin: sum("myntraMargin"), fees: sum("fees"), productCost: sum("productCost"), estimated: sum("estimated"),
  };
  const shipped = t.units + t.rtoUnits;
  const profit = t.revenue - t.fees - t.productCost - adTotal;

  // Payouts grouped by UTR (bank reference), for matching bank credits.
  const utr = new Map<string, { date: string | null; amount: number; lines: number }>();
  for (const s of settlement) for (const [u, amt, dt] of [[s.utr_postpaid, s.settled_postpaid, s.date_postpaid], [s.utr_prepaid, s.settled_prepaid, s.date_prepaid]] as const) {
    if (!u || !amt) continue;
    const x = utr.get(u) ?? { date: dt, amount: 0, lines: 0 };
    x.amount += amt; x.lines++; utr.set(u, x);
  }

  return {
    rows,
    totals: { ...t, shipped, ads: adTotal, estimatedLines, profit, margin: t.sales ? profit / t.sales : 0, rtoRate: shipped ? t.rtoUnits / shipped : 0, returnRate: t.units ? t.returnUnits / t.units : 0 },
    status,
    utrs: [...utr.entries()].map(([u, v]) => ({ utr: u, ...v })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    ads, adStyles, unmatchedAdReports, adsUnallocated,
    reasons: [...reasonCount.values()].sort((a, b) => b.count - a.count),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
