// FirstCry (marketplace / dropship) calculations. Pure functions, so they run in tests too.
//
// How FirstCry pays (seen in Root and Soil's Vendor Reconciliation files, Aug–Oct 2026):
//   for each unit delivered, FirstCry pays a fixed "base cost" plus GST on it. There are no separate commission,
//   shipping or fee lines: FirstCry's share is MRP (excl. GST) − base cost. Undelivered units (RTO) and customer
//   returns are recovered with debit notes, so they earn nothing.
//
//   revenue (excl. GST) = base cost − RTO base − customer-return base        (actual, from Vendor Reconciliation)
//                       + estimated base cost for ordered units not yet in a Vendor Reconciliation file
//   product cost        = units not returned to origin × (cost per unit, or cost % × MRP)
//   profit              = revenue − product cost       (no FirstCry ads data yet)
//   margin              = profit ÷ sales, where sales = MRP excl. GST of units not returned (FirstCry's files have no
//                         customer price), so margins compare with Amazon's profit ÷ net sales.
import type { AccountDefaults, ProductSetting } from "./types";

export type FcSaleRow = { poid: string; product_id: string; order_date: string; quantity: number; mrp: number; mrp_sales: number };
export type FcReconRow = {
  poid: string; poitem_id: string; product_id: string; order_date: string; delivery_date: string | null; return_date: string | null;
  quantity: number; mrp: number; base_cost: number; gross_amount: number; gst_rate: number; gst_amount: number; total: number;
  vendor_invoice: string | null; payment_advice: string | null; debit_note: string | null;
  sr_qty: number; sr_gross: number; sr_total: number; rto_qty: number; rto_gross: number; rto_total: number;
};
export type FcRateRow = { product_id: string; order_date: string; base_cost: number; mrp: number; gst_rate: number };
export type FcReturnRow = { poid: string; product_id: string; return_date: string; quantity: number; reason: string; sub_reason: string };
export type FcProduct = { asin: string; title: string; short_name: string; mrp?: number | null; gst_rate?: number | null; style_code?: string | null };

export type UnitStatus = "paid" | "awaiting_payment" | "in_transit" | "rto" | "customer_return" | "not_invoiced";
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  paid: "Paid",
  awaiting_payment: "Delivered, awaiting payment",
  in_transit: "Shipped, not yet delivered",
  rto: "Not delivered (RTO), debited",
  customer_return: "Customer return, debited",
  not_invoiced: "Ordered, not yet invoiced (estimated)",
};

export type FcProductRow = {
  id: string; name: string; styleCode: string;
  units: number;            // ordered (invoiced + estimated)
  keptUnits: number;        // not returned to origin
  rtoUnits: number; returnUnits: number; shippedUnits: number;
  mrpValue: number;
  salesExGst: number;       // MRP excl. GST of units not returned: the sales figure margins are measured on
  revenue: number; revenueEstimated: number;
  productCost: number; costPerUnit: number;
  profit: number; margin: number;
  payoutRate: number | null;     // base cost ÷ MRP excl. GST, for this period's invoiced units
  shortfall: number;             // vs the account's usual payout rate, on units kept
  payoutUnits: number;           // invoiced units neither RTO nor returned (what the payout rate is measured on)
};

export type FcResult = {
  rows: FcProductRow[];
  totals: {
    units: number; mrpValue: number;
    salesExGst: number;          // MRP excl. GST of units not returned (FirstCry's files show no customer price)
    revenue: number; revenueActual: number; revenueEstimated: number; estimatedUnits: number;
    productCost: number; profit: number; margin: number;
    shippedUnits: number; rtoUnits: number; returnUnits: number; rtoRate: number; returnRate: number;
    shortfall: number;
  };
  status: Record<UnitStatus, { units: number; amount: number }>;   // amount incl. GST (estimated for not_invoiced)
  advices: { advice: string; units: number; amount: number }[];
  daily: { date: string; revenue: number; units: number; sales: number }[];
  typicalRate: number | null;
  missingRate: string[];        // products with sales but no payout history to estimate from
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const exGst = (mrp: number, rate: number) => mrp / (1 + (rate || 0) / 100);

/** The payout rate most units are paid at (base cost ÷ MRP excl. GST), weighted by units. */
export function typicalPayoutRate(rates: FcRateRow[]): number | null {
  const n = new Map<number, number>();
  for (const r of rates) if (r.mrp > 0) { const k = r4(r.base_cost / exGst(r.mrp, r.gst_rate)); n.set(k, (n.get(k) ?? 0) + 1); }
  let best: number | null = null, top = 0;
  for (const [k, v] of n) if (v > top) { best = k; top = v; }
  return best;
}

export function computeFirstCry(args: {
  sales: FcSaleRow[]; recon: FcReconRow[]; rates: FcRateRow[];
  products: FcProduct[]; settings: ProductSetting[]; defaults: AccountDefaults;
}): FcResult {
  const { sales, recon, rates, products, settings, defaults } = args;
  const product = new Map(products.map((p) => [p.asin, p]));
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const typical = typicalPayoutRate(rates);

  // Latest known base cost per product, to estimate units FirstCry has not invoiced yet.
  const lastBase = new Map<string, { date: string; base: number }>();
  for (const r of rates) { const x = lastBase.get(r.product_id); if (!x || r.order_date >= x.date) lastBase.set(r.product_id, { date: r.order_date, base: r.base_cost }); }
  const missingRate = new Set<string>();
  const estimateBase = (id: string, mrp: number) => {
    const b = lastBase.get(id)?.base;
    if (b != null) return b;
    const gst = product.get(id)?.gst_rate;
    if (typical != null && gst != null) return typical * exGst(mrp, gst);
    missingRate.add(id);
    return 0;
  };
  const unitCost = (id: string, mrp: number) => {
    const s = setting.get(id);
    if (s?.cost_per_unit != null) return Number(s.cost_per_unit);
    return (s?.cost_pct != null ? Number(s.cost_pct) : defaults.default_cost_pct) * mrp;
  };

  type Acc = Omit<FcProductRow, "name" | "styleCode" | "margin" | "payoutRate" | "profit" | "costPerUnit"> & { baseKept: number; exGstKept: number; lastMrp: number };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { id, units: 0, keptUnits: 0, rtoUnits: 0, returnUnits: 0, shippedUnits: 0, mrpValue: 0, revenue: 0, revenueEstimated: 0, productCost: 0, shortfall: 0, payoutUnits: 0, salesExGst: 0, baseKept: 0, exGstKept: 0, lastMrp: 0 }; acc.set(id, a); }
    return a;
  };
  const status = Object.fromEntries(Object.keys(UNIT_STATUS_LABEL).map((k) => [k, { units: 0, amount: 0 }])) as FcResult["status"];
  const advices = new Map<string, { units: number; amount: number }>();
  const daily = new Map<string, { revenue: number; units: number; sales: number }>();
  const day = (d: string) => { let x = daily.get(d); if (!x) { x = { revenue: 0, units: 0, sales: 0 }; daily.set(d, x); } return x; };

  // Invoiced units (Vendor Reconciliation).
  const invoicedByKey = new Map<string, number>();
  for (const r of recon) {
    const key = `${r.poid}|${r.product_id}`;
    invoicedByKey.set(key, (invoicedByKey.get(key) ?? 0) + r.quantity);
    const a = get(r.product_id);
    const revenue = r.gross_amount - r.rto_gross - r.sr_gross;
    const kept = r.quantity - r.rto_qty;
    a.units += r.quantity; a.shippedUnits += r.quantity; a.keptUnits += kept;
    a.rtoUnits += r.rto_qty; a.returnUnits += r.sr_qty;
    a.mrpValue += r.mrp * r.quantity; a.lastMrp = r.mrp || a.lastMrp;
    a.revenue += revenue;
    a.productCost += kept * unitCost(r.product_id, r.mrp);
    if (r.rto_qty === 0 && r.sr_qty === 0) { a.baseKept += r.gross_amount; a.exGstKept += exGst(r.mrp, r.gst_rate) * r.quantity; a.payoutUnits += r.quantity; }
    const d = day(r.order_date); d.revenue += revenue; d.units += r.quantity;
    const netUnits = r.quantity - r.rto_qty - r.sr_qty;
    if (netUnits > 0) { const v = exGst(r.mrp, r.gst_rate) * netUnits; d.sales += v; a.salesExGst += v; }

    const st: UnitStatus = r.rto_qty > 0 ? "rto" : r.sr_qty > 0 ? "customer_return" : r.payment_advice ? "paid" : r.delivery_date ? "awaiting_payment" : "in_transit";
    status[st].units += r.quantity;
    status[st].amount += st === "rto" ? r.rto_total : st === "customer_return" ? r.sr_total : r.total;
    if (r.payment_advice) {
      const x = advices.get(r.payment_advice) ?? { units: 0, amount: 0 };
      x.units += r.quantity; x.amount += r.total; advices.set(r.payment_advice, x);
    }
  }

  // Ordered units not yet in any reconciliation file: estimated at the product's latest base cost.
  const salesByKey = new Map<string, { qty: number; mrp: number; date: string; id: string }>();
  for (const s of sales) {
    if (s.quantity <= 0) continue; // 0 = cancelled
    const key = `${s.poid}|${s.product_id}`;
    const x = salesByKey.get(key) ?? { qty: 0, mrp: s.mrp, date: s.order_date, id: s.product_id };
    x.qty += s.quantity; salesByKey.set(key, x);
  }
  let estimatedUnits = 0;
  for (const [key, s] of salesByKey) {
    const open = s.qty - (invoicedByKey.get(key) ?? 0);
    if (open <= 0) continue;
    const a = get(s.id);
    const base = estimateBase(s.id, s.mrp);
    const gst = product.get(s.id)?.gst_rate ?? 0;
    a.units += open; a.keptUnits += open; a.mrpValue += s.mrp * open; a.lastMrp = s.mrp || a.lastMrp;
    a.revenue += base * open; a.revenueEstimated += base * open;
    a.productCost += open * unitCost(s.id, s.mrp);
    estimatedUnits += open;
    status.not_invoiced.units += open; status.not_invoiced.amount += base * open * (1 + gst / 100);
    const d = day(s.date); d.revenue += base * open; d.units += open;
    const v = exGst(s.mrp, gst) * open; d.sales += v; a.salesExGst += v;
  }

  const rows: FcProductRow[] = [...acc.values()].map((a) => {
    const p = product.get(a.id);
    const payoutRate = a.exGstKept > 0 ? a.baseKept / a.exGstKept : null;
    const shortfall = typical != null && payoutRate != null && payoutRate < typical - 0.005 ? typical * a.exGstKept - a.baseKept : 0;
    const profit = a.revenue - a.productCost;
    return {
      id: a.id, name: p?.short_name || p?.title || `FirstCry ${a.id}`, styleCode: p?.style_code || "",
      units: a.units, keptUnits: a.keptUnits, rtoUnits: a.rtoUnits, returnUnits: a.returnUnits, shippedUnits: a.shippedUnits,
      mrpValue: a.mrpValue, salesExGst: a.salesExGst, revenue: a.revenue, revenueEstimated: a.revenueEstimated,
      productCost: a.productCost, costPerUnit: unitCost(a.id, a.lastMrp || p?.mrp || 0),
      profit, margin: a.salesExGst ? profit / a.salesExGst : 0, payoutRate, shortfall, payoutUnits: a.payoutUnits,
    };
  }).sort((x, y) => y.revenue - x.revenue);

  const t = rows.reduce((s, r) => ({
    units: s.units + r.units, mrpValue: s.mrpValue + r.mrpValue, salesExGst: s.salesExGst + r.salesExGst, revenue: s.revenue + r.revenue, revenueEstimated: s.revenueEstimated + r.revenueEstimated,
    productCost: s.productCost + r.productCost, shippedUnits: s.shippedUnits + r.shippedUnits, rtoUnits: s.rtoUnits + r.rtoUnits,
    returnUnits: s.returnUnits + r.returnUnits, shortfall: s.shortfall + r.shortfall,
  }), { units: 0, mrpValue: 0, salesExGst: 0, revenue: 0, revenueEstimated: 0, productCost: 0, shippedUnits: 0, rtoUnits: 0, returnUnits: 0, shortfall: 0 });
  const profit = t.revenue - t.productCost;

  return {
    rows,
    totals: {
      ...t, revenueActual: t.revenue - t.revenueEstimated, estimatedUnits, profit, margin: t.salesExGst ? profit / t.salesExGst : 0,
      rtoRate: t.shippedUnits ? t.rtoUnits / t.shippedUnits : 0, returnRate: t.shippedUnits ? t.returnUnits / t.shippedUnits : 0,
    },
    status,
    advices: [...advices.entries()].map(([advice, v]) => ({ advice, ...v })).sort((a, b) => b.advice.localeCompare(a.advice)),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    typicalRate: typical,
    missingRate: [...missingRate],
  };
}

// ---------- Demand-based stock plan (dropship: stock sits in the seller's own warehouse) ----------
export type FcStockStatus = "urgent" | "make" | "enough" | "no_sales" | "count_needed";
export const FC_STOCK_LABEL: Record<FcStockStatus, string> = {
  urgent: "Urgent", make: "Make now", enough: "Enough stock", no_sales: "No recent sales", count_needed: "Enter your stock",
};
export type FcStockRow = {
  id: string; name: string; unitsSold: number; perDay: number; leadTime: number; leadTimeOverridden: boolean;
  warehouse: number | null; needed: number; toMake: number; daysLeft: number | null; status: FcStockStatus;
};

/** units to keep = daily rate × (horizon + lead time + safety days); to make = that − warehouse stock (when entered). */
export function computeFcStock(args: { unitsById: Map<string, number>; periodDays: number; products: FcProduct[]; settings: ProductSetting[]; defaults: AccountDefaults }): FcStockRow[] {
  const { unitsById, periodDays, products, settings, defaults } = args;
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const name = new Map(products.map((p) => [p.asin, p.short_name || p.title || p.asin]));
  const out: FcStockRow[] = [];
  for (const [id, sold] of unitsById) {
    const s = setting.get(id);
    const perDay = periodDays > 0 ? sold / periodDays : 0;
    const leadTime = s?.lead_time_days ?? defaults.default_lead_time_days;
    const warehouse = s?.warehouse_stock ?? null;
    const needed = perDay * (defaults.plan_horizon_days + leadTime + defaults.default_safety_days);
    const toMake = Math.max(0, Math.ceil(needed - (warehouse ?? 0) - 1e-9));
    const daysLeft = warehouse != null && perDay > 0 ? warehouse / perDay : null;
    const status: FcStockStatus = perDay === 0 ? "no_sales" : warehouse == null ? "count_needed" : daysLeft! < leadTime ? "urgent" : toMake > 0 ? "make" : "enough";
    out.push({ id, name: name.get(id) ?? `FirstCry ${id}`, unitsSold: sold, perDay, leadTime, leadTimeOverridden: s?.lead_time_days != null, warehouse, needed, toMake, daysLeft, status });
  }
  const rank: Record<FcStockStatus, number> = { urgent: 0, make: 1, count_needed: 2, enough: 3, no_sales: 4 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.needed - a.needed);
}

/** Customer-return reasons, most common first. */
export function returnReasons(rows: FcReturnRow[]) {
  const m = new Map<string, { reason: string; detail: string; units: number }>();
  for (const r of rows) {
    const k = `${r.reason}|${r.sub_reason}`;
    const x = m.get(k) ?? { reason: r.reason || "Not given", detail: r.sub_reason, units: 0 };
    x.units += r.quantity; m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.units - a.units);
}

// ---------- Ads ----------

export type FcAdRow = { grain: string; period_date: string; product_id: string; spend: number; impressions: number; clicks: number; ad_sales: number; orders: number };
export type FcAds = {
  spend: number; adSales: number; clicks: number; orders: number;
  roas: number | null;                 // ad sales at MRP ÷ spend
  spread: boolean;                     // true when some spend comes from a monthly total spread over its days
  byProduct: Map<string, number>;      // spend by product, only when the report is split by product
  daily: Map<string, number>;
};

const daysInMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Ad spend in [from, to]. Day-wise rows count as they are; a month with only a monthly row has its total
 *  spread evenly over its days, and the days inside the period are counted. */
export function fcAdsInPeriod(rows: FcAdRow[], from: string, to: string): FcAds {
  const out: FcAds = { spend: 0, adSales: 0, clicks: 0, orders: 0, roas: null, spread: false, byProduct: new Map(), daily: new Map() };
  const dailyMonths = new Set(rows.filter((r) => r.grain === "day").map((r) => r.period_date.slice(0, 7)));
  const add = (date: string, share: number, r: FcAdRow) => {
    out.spend += r.spend * share; out.adSales += r.ad_sales * share; out.clicks += r.clicks * share; out.orders += r.orders * share;
    out.daily.set(date, (out.daily.get(date) ?? 0) + r.spend * share);
    if (r.product_id) out.byProduct.set(r.product_id, (out.byProduct.get(r.product_id) ?? 0) + r.spend * share);
  };
  for (const r of rows) {
    if (r.grain === "day") { if (r.period_date >= from && r.period_date <= to) add(r.period_date, 1, r); continue; }
    const ym = r.period_date.slice(0, 7);
    if (dailyMonths.has(ym)) continue;
    const n = daysInMonth(ym);
    for (let d = 1; d <= n; d++) {
      const date = `${ym}-${String(d).padStart(2, "0")}`;
      if (date >= from && date <= to) { add(date, 1 / n, r); out.spread = true; }
    }
  }
  out.roas = out.spend > 0 ? out.adSales / out.spend : null;
  return out;
}
