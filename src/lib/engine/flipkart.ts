// Flipkart calculations. Pure functions, so they run in tests too.
//
// How Flipkart pays (Root and Soil's settlement reports, Sep–Oct 2026), per order item:
//   sale amount (what the customer paid, incl. GST)                       e.g. ₹363
//   + offer amount (offers on the order) + my share (the seller's part, negative)   + ₹28
//   = what the seller earns on the sale, incl. GST ("gross")              ₹391
//   − marketplace fee (commission, fixed, collection, shipping, reverse shipping…, excl. GST)
//   − TCS − TDS − GST on the fees (all three are tax credits the seller claims back, so not costs here)
//   + refund (the sale taken back on a return, negative)
//   = bank settlement value                                               ₹388.77
// Courier returns (RTO) take the sale back with no reverse shipping in these files; customer returns also pay return shipping.
//
//   sales (excl. GST)    = the customer's invoice value excl. GST, from the Sales report, net of returns and cancellations
//   revenue (excl. GST)  = gross ÷ (1 + GST rate): includes offers Flipkart funds, so it can be more than sales
//   fees (excl. GST)     = −marketplace fee (Flipkart shows fees before GST)
//   profit               = revenue − fees − product cost − ads
// Items not yet in a settlement report are estimated: gross = price before discount + the seller's share of the discount
// (from the Sales report), fees = the account's recent fee rate.
// The settlement file stores item ids as rounded numbers, so its rows are matched to orders by order id + SKU.
import type { AccountDefaults, ProductSetting } from "./types";

export type FkOrderRow = {
  order_item_id: string; order_id: string; order_date: string; status: string; sku: string; title: string; quantity: number;
  cancelled_on: string | null; cancellation_reason: string; return_reason: string; dispatched_on: string | null; delivered_on: string | null;
};
export type FkSettlementRow = {
  line_key: string; order_id: string; sku: string; quantity: number; order_date: string; neft_id: string; neft_type: string; payment_date: string | null;
  settlement_value: number; sale_amount: number; offer_amount: number; my_share: number; addons: number; marketplace_fee: number;
  commission: number; fixed_fee: number; collection_fee: number; pick_pack_fee: number; shipping_fee: number; reverse_shipping_fee: number; other_fees: number;
  tcs: number; tds: number; gst_on_fees: number; offer_adjustment: number; protection_fund: number; refund: number; return_type: string;
};
export type FkRateRow = Pick<FkSettlementRow, "sku" | "order_date" | "sale_amount" | "offer_amount" | "my_share" | "marketplace_fee" | "reverse_shipping_fee" | "return_type">;
export type FkSaleRow = {
  order_item_id: string; order_id: string; sku: string; event_sub_type: string; order_date: string; quantity: number;
  price_before_discount: number; seller_share: number; invoice_amount: number; taxable_value: number; gst_rate: number;
};
export type FkReturnRow = { order_item_id: string; return_type: string; status: string; reason: string; sub_reason: string; sku: string };
export type FkAdRow = {
  grain: "day" | "range"; period_start: string; period_end: string; campaign_id: string; campaign: string; sku: string; product: string;
  spend: number; views: number; clicks: number; units: number; revenue: number;
};
export type FkOtherRow = { sheet: string; neft_id: string; payment_date: string | null; type: string; reference: string; amount: number; gst: number };
export type FkProduct = { asin: string; title: string; short_name: string };

export type FkLineStatus = "paid" | "not_in_settlement" | "returned" | "rto" | "cancelled";
export const FK_STATUS_LABEL: Record<FkLineStatus, string> = {
  paid: "Paid",
  not_in_settlement: "Not yet in a settlement report (estimated)",
  returned: "Customer return",
  rto: "Not delivered (RTO)",
  cancelled: "Cancelled before shipping",
};

export const FEE_KEYS = ["commission", "fixed_fee", "collection_fee", "pick_pack_fee", "shipping_fee", "reverse_shipping_fee", "other_fees"] as const;
export type FeeKey = (typeof FEE_KEYS)[number];
export const FEE_LABEL: Record<FeeKey, string> = {
  commission: "Commission", fixed_fee: "Fixed fee", collection_fee: "Collection fee", pick_pack_fee: "Pick and pack",
  shipping_fee: "Shipping", reverse_shipping_fee: "Return shipping", other_fees: "Other fees",
};

export type FkProductRow = {
  sku: string; name: string;
  orders: number; units: number; returnUnits: number; rtoUnits: number; cancelled: number;
  sales: number; revenue: number; offers: number; fees: number; productCost: number; ads: number;
  estimated: number; profit: number; margin: number; costPerUnit: number; avgPrice: number;
};

export type FkAdGroup = { key: string; name: string; spend: number; views: number; clicks: number; units: number; revenue: number };
export type FkAds = {
  spend: number; views: number; clicks: number; units: number; revenue: number;
  daysWithData: number; periodDays: number; spread: boolean;   // spread: some days come from a date-range (product) report
  daily: { date: string; value: number }[];
  byMonth: FkAdGroup[]; byCampaign: FkAdGroup[]; byProduct: FkAdGroup[];
  unallocated: number;                                          // spend on days no product report covers
};

export type FkResult = {
  rows: FkProductRow[];
  totals: {
    orders: number; units: number; returnUnits: number; rtoUnits: number; cancelled: number; shipped: number;
    sales: number; revenue: number; offers: number; fees: number; productCost: number; ads: number;
    estimated: number; estimatedLines: number; profit: number; margin: number; rtoRate: number; returnRate: number;
    payout: number; tcs: number; tds: number; gstOnFees: number; feeRate: number;
  };
  fees: Record<FeeKey, number>;                                 // settled fees in the period, excl. GST
  status: Record<FkLineStatus, { lines: number; amount: number }>;
  reasons: { reason: string; kind: "Return" | "RTO / cancelled"; count: number }[];
  daily: { date: string; sales: number; units: number }[];
  ads: FkAds | null;
};

const dayList = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const exGst = (v: number, rate: number) => v / (1 + (rate || 0) / 100);
const gross = (s: FkSettlementRow) => s.sale_amount + s.offer_amount + s.my_share + s.addons + s.refund + s.offer_adjustment + s.protection_fund;
const pretty = (r: string) => r.replace(/_/g, " ").replace(/^ORC_/i, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** Ads in [from, to]. Totals come from the campaign-by-day report where a day has one; otherwise from product reports
 *  for a date range, spread evenly over their days. Each day's spend is split across products by the product reports
 *  that cover that day. */
export function fkAdsInPeriod(rows: FkAdRow[], from: string, to: string, names: Map<string, string>): FkAds | null {
  if (!rows.length) return null;
  const days = dayList(from, to);
  const byDay = new Map<string, FkAdRow[]>();
  for (const r of rows) if (r.grain === "day" && r.period_start >= from && r.period_start <= to) byDay.set(r.period_start, [...(byDay.get(r.period_start) ?? []), r]);
  const ranges = rows.filter((r) => r.grain === "range" && r.period_end >= from && r.period_start <= to);
  const out: FkAds = { spend: 0, views: 0, clicks: 0, units: 0, revenue: 0, daysWithData: 0, periodDays: days.length, spread: false, daily: [], byMonth: [], byCampaign: [], byProduct: [], unallocated: 0 };
  const groups = { m: new Map<string, FkAdGroup>(), c: new Map<string, FkAdGroup>(), p: new Map<string, FkAdGroup>() };
  const bump = (m: Map<string, FkAdGroup>, key: string, name: string, f: number, r: { spend: number; views: number; clicks: number; units: number; revenue: number }) => {
    let g = m.get(key);
    if (!g) { g = { key, name, spend: 0, views: 0, clicks: 0, units: 0, revenue: 0 }; m.set(key, g); }
    g.spend += r.spend * f; g.views += r.views * f; g.clicks += r.clicks * f; g.units += r.units * f; g.revenue += r.revenue * f;
  };
  for (const d of days) {
    const cover = ranges.filter((r) => r.period_start <= d && r.period_end >= d);
    const share = (r: FkAdRow) => 1 / daysBetween(r.period_start, r.period_end);
    const dayRows = byDay.get(d);
    let total = 0;
    if (dayRows?.length) {
      for (const r of dayRows) { total += r.spend; out.views += r.views; out.clicks += r.clicks; out.units += r.units; out.revenue += r.revenue; bump(groups.c, r.campaign_id, r.campaign, 1, r); bump(groups.m, d.slice(0, 7), d.slice(0, 7), 1, r); }
    } else if (cover.length) {
      out.spread = true;
      for (const r of cover) { const f = share(r); total += r.spend * f; out.views += r.views * f; out.clicks += r.clicks * f; out.units += r.units * f; out.revenue += r.revenue * f; bump(groups.c, r.campaign_id, r.campaign, f, r); bump(groups.m, d.slice(0, 7), d.slice(0, 7), f, r); }
    } else continue;
    out.daysWithData++;
    out.spend += total;
    out.daily.push({ date: d, value: total });
    // Split the day's spend across products in proportion to the covering product reports.
    const coverSpend = cover.reduce((s, r) => s + r.spend * share(r), 0);
    if (!coverSpend) { out.unallocated += total; continue; }
    const scale = total / coverSpend;
    for (const r of cover) {
      const f = share(r) * scale;
      if (!r.sku) { out.unallocated += r.spend * f; continue; }
      bump(groups.p, r.sku, names.get(r.sku) || r.product || r.sku, f, r);
    }
  }
  const bySpend = (a: FkAdGroup, b: FkAdGroup) => b.spend - a.spend;
  out.byMonth = [...groups.m.values()].sort((a, b) => a.key.localeCompare(b.key));
  out.byCampaign = [...groups.c.values()].sort(bySpend);
  out.byProduct = [...groups.p.values()].sort(bySpend);
  return out.daysWithData ? out : null;
}

export function computeFlipkart(args: {
  orders: FkOrderRow[]; settlement: FkSettlementRow[]; rates: FkRateRow[]; sales: FkSaleRow[]; returns: FkReturnRow[];
  ads: FkAdRow[]; products: FkProduct[]; settings: ProductSetting[]; defaults: AccountDefaults; from: string; to: string;
}): FkResult {
  const { orders, settlement, rates, sales, returns, ads, products, settings, defaults, from, to } = args;
  const product = new Map(products.map((p) => [p.asin, p]));
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const names = new Map(products.map((p) => [p.asin, p.short_name || p.title]));

  // GST rate by item and by SKU, from the Sales report.
  const salesByItem = new Map<string, FkSaleRow[]>();
  const gstBySku = new Map<string, number>();
  for (const s of sales) {
    salesByItem.set(s.order_item_id, [...(salesByItem.get(s.order_item_id) ?? []), s]);
    if (s.gst_rate) gstBySku.set(s.sku, s.gst_rate);
  }
  const gstOf = (item: string, sku: string) => salesByItem.get(item)?.find((s) => s.gst_rate)?.gst_rate ?? gstBySku.get(sku) ?? 18;

  // Fee rate for estimates: settled sales in the 30 days of order dates up to the latest settled one (Flipkart changes fees
  // often: Root and Soil paid commission in September and none in October).
  const fwd = rates.filter((r) => r.sale_amount > 0);
  const latestSettled = fwd.map((r) => r.order_date).sort().pop() ?? null;
  let feeSum = 0, grossSum = 0;
  const unitGross = new Map<string, { date: string; value: number }>();
  for (const r of fwd) {
    const g = r.sale_amount + r.offer_amount + r.my_share;
    if (latestSettled && Date.parse(latestSettled) - Date.parse(r.order_date) <= 29 * 86400000) { feeSum += -r.marketplace_fee; grossSum += g; }
    const x = unitGross.get(r.sku); // settlement rows are per item
    if (!x || r.order_date >= x.date) unitGross.set(r.sku, { date: r.order_date, value: g });
  }
  const feeRate = grossSum ? feeSum / grossSum : 0;   // fees excl. GST ÷ gross incl. GST
  const custRet = rates.filter((r) => /customer/i.test(r.return_type) && r.reverse_shipping_fee);
  const returnShipping = custRet.length ? -custRet.reduce((s, r) => s + r.reverse_shipping_fee, 0) / custRet.length : 0;

  // Settlement rows by order id + SKU; items sharing a key (two units of one SKU in an order) share its rows.
  const settleByLine = new Map<string, FkSettlementRow[]>();
  for (const s of settlement) settleByLine.set(s.line_key, [...(settleByLine.get(s.line_key) ?? []), s]);
  const itemsPerLine = new Map<string, number>();
  for (const o of orders) { const k = `${o.order_id}|${o.sku}`; itemsPerLine.set(k, (itemsPerLine.get(k) ?? 0) + 1); }
  const retByItem = new Map<string, FkReturnRow>();
  for (const r of returns) if (r.status !== "cancelled") retByItem.set(r.order_item_id, r);

  const unitCost = (sku: string, priceInclGst: number) => {
    const s = setting.get(sku);
    if (s?.cost_per_unit != null) return Number(s.cost_per_unit);
    return (s?.cost_pct != null ? Number(s.cost_pct) : defaults.default_cost_pct) * priceInclGst;
  };

  type Acc = Omit<FkProductRow, "name" | "margin" | "profit" | "costPerUnit" | "avgPrice"> & { lastPrice: number; priceSum: number };
  const acc = new Map<string, Acc>();
  const get = (sku: string) => {
    let a = acc.get(sku);
    if (!a) { a = { sku, orders: 0, units: 0, returnUnits: 0, rtoUnits: 0, cancelled: 0, sales: 0, revenue: 0, offers: 0, fees: 0, productCost: 0, ads: 0, estimated: 0, lastPrice: 0, priceSum: 0 }; acc.set(sku, a); }
    return a;
  };
  const status = Object.fromEntries(Object.keys(FK_STATUS_LABEL).map((k) => [k, { lines: 0, amount: 0 }])) as FkResult["status"];
  const fees = Object.fromEntries(FEE_KEYS.map((k) => [k, 0])) as Record<FeeKey, number>;
  const daily = new Map<string, { sales: number; units: number }>();
  const reasonCount = new Map<string, { reason: string; kind: "Return" | "RTO / cancelled"; count: number }>();
  const reason = (r: string, kind: "Return" | "RTO / cancelled") => { const label = pretty(r) || "No reason in Flipkart's report"; const k = kind + label; const x = reasonCount.get(k) ?? { reason: label, kind, count: 0 }; x.count++; reasonCount.set(k, x); };
  let estimatedLines = 0, payout = 0, tcs = 0, tds = 0, gstOnFees = 0;

  // Every order item in the period, from the orders report; plus settled lines whose orders report was not uploaded.
  type Line = { item: string; key: string; date: string; sku: string; o?: FkOrderRow; share: number };
  const lines: Line[] = orders.map((o) => { const key = `${o.order_id}|${o.sku}`; return { item: o.order_item_id, key, date: o.order_date, sku: o.sku, o, share: 1 / (itemsPerLine.get(key) ?? 1) }; });
  const known = new Set(lines.map((l) => l.key));
  for (const [key, rows] of settleByLine) if (!known.has(key) && rows[0].order_date >= from && rows[0].order_date <= to) lines.push({ item: "", key, date: rows[0].order_date, sku: rows[0].sku, share: 1 });

  for (const l of lines) {
    const a = get(l.sku);
    const o = l.o;
    a.orders++;
    const srows = settleByLine.get(l.key) ?? [];
    const ret = l.item ? retByItem.get(l.item) : undefined;
    const sRet = srows.find((s) => s.return_type);
    const shipped = !!(o?.dispatched_on || o?.delivered_on || srows.length);
    const gstRate = gstOf(l.item, l.sku);
    const ev = l.item ? salesByItem.get(l.item) ?? [] : [];
    const saleEv = ev.find((e) => e.event_sub_type === "Sale");
    const price = saleEv?.invoice_amount ?? (srows.length ? srows.reduce((s, r) => s + r.sale_amount, 0) * l.share : 0);

    // Settled amounts (shared between items of one key).
    const settled = srows.length > 0;
    const sGross = srows.reduce((s, r) => s + gross(r), 0) * l.share;
    const sFees = -srows.reduce((s, r) => s + r.marketplace_fee, 0) * l.share;
    const sPay = srows.reduce((s, r) => s + r.settlement_value, 0) * l.share;
    if (settled) {
      payout += sPay;
      tcs += -srows.reduce((s, r) => s + r.tcs, 0) * l.share; tds += -srows.reduce((s, r) => s + r.tds, 0) * l.share;
      gstOnFees += -srows.reduce((s, r) => s + r.gst_on_fees, 0) * l.share;
      for (const k of FEE_KEYS) fees[k] += -srows.reduce((s, r) => s + r[k], 0) * l.share;
    }

    const cancelledBeforeShip = o?.status === "CANCELLED" && !o.dispatched_on && !o.delivered_on && !srows.some((r) => r.sale_amount);
    const isRto = !cancelledBeforeShip && (ret?.return_type === "courier_return" || /logistics/i.test(sRet?.return_type ?? "") || (o?.status === "CANCELLED" && shipped)
      || (o?.status === "RETURNED" && !ret && !o.delivered_on));
    const isCustomerReturn = !isRto && (ret?.return_type === "customer_return" || /customer/i.test(sRet?.return_type ?? "") || (o?.status === "RETURNED" && !!o.delivered_on));

    if (cancelledBeforeShip) { a.cancelled++; status.cancelled.lines++; reason(o?.cancellation_reason ? o.cancellation_reason : "Cancelled before shipping", "RTO / cancelled"); continue; }
    if (isRto) {
      a.rtoUnits += o?.quantity ?? 1; status.rto.lines++;
      reason(ret?.reason || o?.return_reason || o?.cancellation_reason || "", "RTO / cancelled");
      // An RTO earns nothing. Once Flipkart has reversed it, the settled rows net to the charges it kept; until then
      // (sale paid, reversal in a later report) the sale is left out.
      const reversed = srows.some((r) => r.refund);
      if (settled && reversed) { a.revenue += exGst(sGross, gstRate); a.fees += sFees; status.rto.amount += sPay; }
      continue;
    }

    const qty = o?.quantity ?? (srows.reduce((s, r) => s + r.quantity, 0) || 1);
    a.units += qty; a.lastPrice = price || a.lastPrice; a.priceSum += price;
    // Sales: invoice value excl. GST, net of returns and cancellations, from the Sales report; else from the settlement.
    const salesEx = ev.length ? ev.reduce((s, e) => s + e.taxable_value, 0) : exGst(srows.reduce((s, r) => s + r.sale_amount + r.refund, 0) * l.share, gstRate);
    let revEx: number, feeEx: number, estPayout = 0;
    if (settled && (!isCustomerReturn || srows.some((r) => r.refund))) { revEx = exGst(sGross, gstRate); feeEx = sFees; }
    else if (settled) {
      // Returned, but the reversal is not in the uploaded settlement reports yet: take the sale back, add return shipping.
      revEx = 0; feeEx = sFees + returnShipping;
      a.estimated += -exGst(sGross, gstRate) - returnShipping; estimatedLines++;
    } else {
      const g = saleEv ? saleEv.price_before_discount + saleEv.seller_share : (unitGross.get(l.sku)?.value ?? price) * qty;
      revEx = exGst(g, gstRate); feeEx = feeRate * g;
      if (isCustomerReturn) { revEx = 0; feeEx += returnShipping; }
      estPayout = revEx * (1 + gstRate / 100) - feeEx * 1.18; // before TCS and TDS
      a.estimated += revEx - feeEx; estimatedLines++;
    }
    a.sales += salesEx; a.revenue += revEx; a.fees += feeEx;
    a.productCost += unitCost(l.sku, price / qty) * qty;
    const d = daily.get(l.date) ?? { sales: 0, units: 0 }; d.sales += salesEx; d.units += qty; daily.set(l.date, d);

    if (isCustomerReturn) {
      a.returnUnits += qty; status.returned.lines++; status.returned.amount += settled ? sPay : 0;
      reason(ret?.reason || o?.return_reason || "", "Return");
      continue;
    }
    if (settled) { status.paid.lines++; status.paid.amount += sPay; }
    else { status.not_in_settlement.lines++; status.not_in_settlement.amount += estPayout; }
  }

  // Ads: spend excl. GST from Flipkart Ads reports, split by product where a product report covers the day.
  const adsRes = fkAdsInPeriod(ads, from, to, names);
  if (adsRes) for (const g of adsRes.byProduct) get(g.key).ads += g.spend;

  const rows: FkProductRow[] = [...acc.values()].map((a) => {
    const profit = a.revenue - a.fees - a.productCost - a.ads;
    const p = product.get(a.sku);
    const { priceSum, lastPrice, ...rest } = a;
    return { ...rest, offers: a.revenue - a.sales, name: p?.short_name || p?.title || a.sku, profit, margin: a.sales ? profit / a.sales : 0, costPerUnit: unitCost(a.sku, lastPrice), avgPrice: a.units ? priceSum / a.units : 0 };
  }).filter((r) => r.orders > 0 || r.ads > 0).sort((x, y) => y.sales - x.sales);
  const sum = (k: keyof FkProductRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const t = {
    orders: sum("orders"), units: sum("units"), returnUnits: sum("returnUnits"), rtoUnits: sum("rtoUnits"), cancelled: sum("cancelled"),
    sales: sum("sales"), revenue: sum("revenue"), fees: sum("fees"), productCost: sum("productCost"), estimated: sum("estimated"),
  };
  const adTotal = adsRes?.spend ?? 0;
  const shipped = t.units + t.rtoUnits;
  const profit = t.revenue - t.fees - t.productCost - adTotal;
  return {
    rows,
    totals: {
      ...t, offers: t.revenue - t.sales, shipped, ads: adTotal, estimatedLines, profit, margin: t.sales ? profit / t.sales : 0,
      rtoRate: shipped ? t.rtoUnits / shipped : 0, returnRate: t.units ? t.returnUnits / t.units : 0, payout, tcs, tds, gstOnFees, feeRate,
    },
    fees, status,
    reasons: [...reasonCount.values()].sort((a, b) => b.count - a.count),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    ads: adsRes,
  };
}

/** Payouts by NEFT (bank transfer) for payments dated in the period: order rows plus deductions not tied to an order. */
export function fkPayouts(settlement: FkSettlementRow[], other: FkOtherRow[]) {
  const m = new Map<string, { neft: string; date: string | null; type: string; orders: number; orderRows: number; deductions: number; ads: number }>();
  const get = (neft: string, date: string | null) => {
    let x = m.get(neft);
    if (!x) { x = { neft, date, type: "", orders: 0, orderRows: 0, deductions: 0, ads: 0 }; m.set(neft, x); }
    if (date && (!x.date || date > x.date)) x.date = date;
    return x;
  };
  for (const s of settlement) { const x = get(s.neft_id, s.payment_date); x.orders += s.settlement_value; x.orderRows++; if (s.neft_type) x.type = x.type && x.type !== s.neft_type ? "Mixed" : s.neft_type; }
  for (const o of other) { const x = get(o.neft_id, o.payment_date); x.deductions += o.amount; if (/^ads$/i.test(o.sheet)) x.ads += o.amount; }
  return [...m.values()].map((x) => ({ ...x, total: x.orders + x.deductions })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
