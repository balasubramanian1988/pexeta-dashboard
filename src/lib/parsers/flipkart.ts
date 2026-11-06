// Flipkart reports → sd_fk_ tables. Pure functions: no database access.
// Reports, as downloaded from Flipkart Seller Hub (Nov 2026, Root and Soil):
//   Orders report (Reports › Orders)            – one row per order item: status, SKU, FSN, dates, cancellation and return reasons
//   Returns report (Returns › download)          – courier returns (RTO) and customer returns, with reasons
//   Sales report (Reports › Tax reports)         – one row per sale / return / cancellation event: GST invoice values
//   Settlement report (Payments › Settlements)  – "Orders" sheet: per order item per payout (sale, offers, fees, TCS/TDS, refund);
//                                                  "Ads" and other sheets: deductions not tied to an order
//   Flipkart Ads reports (CSV)                   – campaign by day, and product (SKU) for a date range
//   Commission / tax invoices and credit notes (PDF)
// Flipkart writes text cells as '"""SKU:WPSAL25"""' and item ids as "OI:438…"; both are cleaned here.
import type { Parsed } from "./map";
import type { Table } from "./read";
import { num, parseTimestamp, istDate, rowHasher, str, type Cell, type Row } from "./util";

function base(type: Parsed["type"], table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}
function period(p: Parsed, dates: (string | null)[]) {
  const d = dates.filter(Boolean).sort() as string[];
  p.periodStart = d[0] ?? null;
  p.periodEnd = d[d.length - 1] ?? null;
}

/** '"""SKU:WPSAL25"""' → "WPSAL25"; '"""Root and Soil …"""' → "Root and Soil …". */
function clean(v: Cell): string {
  return str(v).replace(/^["'\s]+|["'\s]+$/g, "").replace(/^(SKU|FSN):/i, "").replace(/\s+/g, " ").trim();
}
const itemId = (v: Cell) => clean(typeof v === "number" ? String(Math.round(v)) : v).replace(/^OI:/i, "");
const n = (v: Cell) => num(typeof v === "string" ? v.replace(/["']/g, "") : v);

/** "2026-10-01 20:42:07", "2026-09-01 00:00:00.0", "2026-10-15", Excel date → YYYY-MM-DD. */
function day(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = clean(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  return d ? `${d[3]}-${d[2]}-${d[1]}` : null;
}

/** Column lookup by the start of the header: Flipkart headers carry formulas and line breaks
 *  ("Marketplace Fee (Rs.)\n= SUM (N:AJ)", " Payment Date", "Bank Settlement Value (Rs.) "). */
function columns(headers: string[]) {
  const norm = (h: string) => h.split("\n")[0].replace(/\s+/g, " ").trim().toLowerCase();
  const list = headers.map((h) => ({ h, k: norm(h) }));
  return (row: Row, ...starts: string[]): Cell => {
    for (const s of starts) {
      const want = s.toLowerCase();
      const hit = list.find((x) => x.k === want) ?? list.find((x) => x.k.startsWith(want));
      if (hit && row[hit.h] !== undefined) return row[hit.h];
    }
    return undefined;
  };
}

// ---------- Orders report ----------
export function fkOrders(t: Table): Parsed {
  const p = base("fk_orders", "sd_fk_orders");
  for (const r of t.rows) {
    const id = itemId(r["order_item_id"]);
    const at = parseTimestamp(clean(r["order_date"]).replace(/\.\d+$/, ""), true);
    if (!id || !at) continue;
    const sku = clean(r["sku"]), fsn = clean(r["fsn"]), title = clean(r["product_title"]);
    p.rows.push({
      order_item_id: id, order_id: clean(r["order_id"]), ordered_at: at.toISOString(), order_date: istDate(at),
      status: clean(r["order_item_status"]).toUpperCase(), fulfilment_type: clean(r["fulfilment_type"]),
      sku, fsn, title, quantity: n(r["quantity"]) || 1,
      cancelled_on: day(r["order_cancellation_date"]), cancellation_reason: clean(r["cancellation_reason"]), cancellation_sub_reason: clean(r["cancellation_sub_reason"]),
      return_id: clean(r["return_id"]), return_reason: clean(r["return_reason"]), return_sub_reason: clean(r["return_sub_reason"]),
      dispatched_on: day(r["dispatched_date"]), delivered_on: day(r["order_delivery_date"]),
      dispatch_sla_breached: clean(r["dispatch_sla_breached"]).toUpperCase() === "Y",
    });
    if (sku) {
      p.products.push({ asin: sku, title });
      if (fsn) p.skus.push({ sku: fsn, asin: sku, fulfillment: "Flipkart FSN" });
    }
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

// ---------- Returns report ----------
export function fkReturns(t: Table): Parsed {
  const p = base("fk_returns", "sd_fk_returns");
  for (const r of t.rows) {
    const rid = clean(r["return_id"]), item = itemId(r["order_item_id"]);
    if (!rid || !item) continue;
    p.rows.push({
      return_id: rid, order_item_id: item, return_type: clean(r["return_type"]).toLowerCase(), status: clean(r["return_status"]).toLowerCase(),
      reason: clean(r["return_reason"]), sub_reason: clean(r["return_sub_reason"]),
      requested_on: day(r["return_requested_date"]), approved_on: day(r["return_approval_date"]), completed_on: day(r["return_completion_date"]),
      sku: clean(r["sku"]), quantity: n(r["quantity"]) || 1, condition: clean(r["final_condition_of_returned_product"]),
    });
  }
  period(p, p.rows.map((x) => (x.approved_on || x.requested_on || x.completed_on) as string | null));
  return p;
}

// ---------- Sales report (GST) ----------
export function fkSales(t: Table): Parsed {
  const p = base("fk_sales", "sd_fk_sales");
  const col = columns(t.headers);
  const hash = rowHasher();
  for (const r of t.rows) {
    const item = itemId(col(r, "order item id"));
    const orderDate = day(col(r, "order date"));
    const sub = clean(col(r, "event sub type"));
    if (!item || !orderDate || !sub) continue;
    const invoice = clean(col(r, "buyer invoice id"));
    const gstRate = n(col(r, "igst rate")) + n(col(r, "cgst rate")) + n(col(r, "sgst rate"));
    const taxable = n(col(r, "taxable value"));
    p.rows.push({
      row_key: hash([item, sub, invoice, clean(col(r, "buyer invoice date")), String(taxable)]),
      order_item_id: item, order_id: clean(col(r, "order id")), sku: clean(col(r, "sku")), fsn: clean(col(r, "fsn")),
      event_type: clean(col(r, "event type")), event_sub_type: sub, order_date: orderDate,
      invoice_id: invoice, invoice_date: day(col(r, "buyer invoice date")), quantity: n(col(r, "item quantity")),
      price_before_discount: n(col(r, "price before discount")), total_discount: n(col(r, "total discount")),
      seller_share: n(col(r, "seller share")), bank_offer_share: n(col(r, "bank offer share")),
      invoice_amount: n(col(r, "final invoice amount")), taxable_value: taxable, gst_rate: gstRate,
      gst_amount: n(col(r, "igst amount")) + n(col(r, "cgst amount")) + n(col(r, "sgst amount")),
      tcs: n(col(r, "total tcs deducted")), tds: n(col(r, "tds amount")),
      delivery_state: clean(col(r, "customer's delivery state")), shopsy: /^y/i.test(clean(col(r, "is shopsy order?"))),
    });
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

// ---------- Settlement report: Orders sheet ----------
const FEE_COLS = ["no cost emi fee", "installation fee", "tech visit fee", "uninstallation", "customer add-ons amount recovery", "franchise fee", "shopsy marketing fee", "product cancellation fee"];

export function fkSettlement(t: Table): Parsed {
  const p = base("fk_settlement", "sd_fk_settlement");
  const col = columns(t.headers);
  const hash = rowHasher();
  let total = 0;
  for (const r of t.rows) {
    const orderId = clean(col(r, "order id"));
    const orderDate = day(col(r, "order date"));
    if (!/^OD/i.test(orderId) || !orderDate) continue;
    const sku = clean(col(r, "seller sku"));
    const neft = clean(col(r, "neft id"));
    const ref = col(r, "order item id");
    const itemRef = typeof ref === "number" ? ref.toPrecision(15).replace(/\.?0+e/, "e") : clean(ref);
    const value = n(col(r, "bank settlement value"));
    const fee = (k: string) => n(col(r, k));
    const other = FEE_COLS.reduce((s, k) => s + fee(k), 0);
    const row = {
      neft_id: neft, neft_type: clean(col(r, "neft type")), payment_date: day(col(r, "payment date")),
      order_id: orderId, order_item_ref: itemRef, line_key: `${orderId}|${sku}`, sku, quantity: n(col(r, "quantity")),
      order_date: orderDate, dispatch_date: day(col(r, "dispatch date")),
      settlement_value: value, sale_amount: n(col(r, "sale amount (rs.)")), offer_amount: n(col(r, "total offer amount (rs.)")),
      my_share: n(col(r, "my share (rs.)")), addons: n(col(r, "customer add-ons amount (rs.)")),
      marketplace_fee: n(col(r, "marketplace fee")), commission: fee("commission (rs.)"), fixed_fee: fee("fixed fee"),
      collection_fee: fee("collection fee"), pick_pack_fee: fee("pick and pack fee"), shipping_fee: fee("shipping fee"),
      reverse_shipping_fee: fee("reverse shipping fee"), other_fees: other,
      tcs: n(col(r, "tcs (rs.)")), tds: n(col(r, "tds (rs.)")), gst_on_fees: n(col(r, "gst on mp fees")),
      offer_adjustment: n(col(r, "offer adjustments (rs.)")), protection_fund: n(col(r, "protection fund")), refund: n(col(r, "refund")),
      commission_rate: n(col(r, "commission rate")), return_type: clean(col(r, "return type")),
      item_return_status: clean(col(r, "item return status")).replace(/[^\x20-\x7E]+/g, "'"), shipping_zone: clean(col(r, "shipping zone")),
      invoice_id: clean(col(r, "invoice id")),
    };
    p.rows.push({ row_key: hash([neft, orderId, itemRef, sku, String(value), String(row.sale_amount), String(row.refund), String(row.marketplace_fee), row.return_type]), ...row });
    total += value;
  }
  period(p, p.rows.map((x) => x.order_date as string));
  if (p.rows.length) p.warnings.push(`Bank settlement value ₹${total.toLocaleString("en-IN", { maximumFractionDigits: 2 })} across ${p.rows.length} rows: it should equal "Orders" on the report's Summary sheet.`);
  return p;
}

// ---------- Settlement report: sheets not tied to an order ----------
export function fkSettlementOther(t: Table, sheet: string): Parsed {
  const p = base("fk_settlement_other", "sd_fk_settlement_other");
  const col = columns(t.headers);
  const hash = rowHasher();
  for (const r of t.rows) {
    const neft = clean(col(r, "neft id"));
    const date = day(col(r, "payment date"));
    if ((!neft && !date) || /^neft id$/i.test(neft)) continue; // the second header row Flipkart repeats under merged titles
    const amount = n(col(r, "settlement value"));
    const type = clean(col(r, "type"));
    const ref = clean(col(r, "campaign / transaction id", "transaction id", "campaign id", "listing id", "recall id", "order item id"));
    const gst = n(col(r, "gst on ads fees", "gst"));
    p.rows.push({ row_key: hash([sheet, neft, String(date), type, ref, String(amount), String(gst)]), sheet, neft_id: neft, payment_date: date, type, reference: ref, amount, gst });
  }
  period(p, p.rows.map((x) => x.payment_date as string | null));
  return p;
}

// ---------- Flipkart Ads ----------
export function fkAdsDaily(t: Table): Parsed {
  const p = base("fk_ads_daily", "sd_fk_ads");
  const hash = rowHasher();
  for (const r of t.rows) {
    const date = day(r["Date"]);
    const cid = clean(r["Campaign ID"]);
    if (!date || !cid) continue;
    const units = n(r["Total converted units"]);
    p.rows.push({
      row_key: hash(["day", date, cid]), grain: "day", period_start: date, period_end: date, campaign_id: cid, campaign: clean(r["Campaign Name"]),
      sku: "", product: "", spend: n(r["Ad Spend"]), views: n(r["Views"]), clicks: n(r["Clicks"]), units, direct_units: 0, revenue: n(r["Total Revenue (Rs.)"]),
    });
  }
  period(p, p.rows.map((x) => x.period_start as string));
  return p;
}

export function fkAdsProducts(t: Table): Parsed {
  const p = base("fk_ads_products", "sd_fk_ads");
  const start = day(t.meta?.["start time"] ?? null), end = day(t.meta?.["end time"] ?? null);
  if (!start || !end) { p.warnings.push("The file has no Start Time / End Time lines at the top. Download it again from Flipkart Ads without editing it."); return p; }
  for (const r of t.rows) {
    const cid = clean(r["Campaign ID"]);
    if (!cid) continue;
    const sku = clean(r["Sku Id"]);
    const direct = n(r["Direct Units Sold"]);
    p.rows.push({
      // One row per campaign, ad group and SKU for the date range: re-uploading the same range replaces it.
      row_key: ["range", start, end, cid, clean(r["AdGroup ID"]), sku].join("|"), grain: "range", period_start: start, period_end: end,
      campaign_id: cid, campaign: clean(r["Campaign Name"]), sku, product: clean(r["Product Name"]),
      spend: n(r["Ad Spend"]), views: n(r["Views"]), clicks: n(r["Clicks"]), units: direct + n(r["Indirect Units Sold"]), direct_units: direct, revenue: n(r["Total Revenue (Rs.)"]),
    });
  }
  p.periodStart = start; p.periodEnd = end;
  return p;
}

// ---------- Commission / tax invoice or credit note (PDF) ----------
export function fkInvoice(text: string): Parsed {
  const p = base("fk_invoice", "sd_fk_invoices");
  const flat = text.replace(/\s+/g, " ");
  const credit = /CREDIT NOTE/i.test(flat);
  // Numbers look like FKRKA27001370475 (invoice) and FKCKA27000804358 (credit note); the label and number can land on
  // different lines, so take the first number of the right kind.
  const number = flat.match(credit ? /\bFKC[A-Z]{2}\d{8,}\b/ : /\bFKR[A-Z]{2}\d{8,}\b/)?.[0] ?? flat.match(/(?:Invoice|Credit Note) #\s*:?\s*([A-Z0-9]{10,})/i)?.[1] ?? "";
  const dm = flat.match(credit ? /Credit Note Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i : /Invoice Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i);
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : "";
  const original = credit ? flat.match(/\bFKR[A-Z]{2}\d{8,}\b/)?.[0] ?? "" : "";
  if (!number || !date) { p.warnings.push("Could not read the invoice number or date."); return p; }
  // Service lines end in "<taxable> <GST rate> <GST> <total>". Descriptions can wrap above and below the numbers, so each
  // line is named from the text between it and the line before ("Customer Add-ons … Amount Recovery" is not a fee).
  const amounts = { ads: 0, commission: 0, fixed_fee: 0, shipping: 0, other: 0 };
  const body = flat.slice(flat.search(/Accounting Codes|Description/i) + 1);
  let baseSum = 0, last = 0;
  for (const m of body.matchAll(/([\d,]+\.\d{2})\s+(\d{1,2}\.\d{1,2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g)) {
    const desc = body.slice(last, m.index).toLowerCase();
    last = (m.index ?? 0) + m[0].length;
    const v = Number(m[1].replace(/,/g, ""));
    baseSum += v;
    if (/ad services|ads fee/.test(desc)) amounts.ads += v;
    else if (/commission/.test(desc)) amounts.commission += v;
    else if (/fixed fee/.test(desc)) amounts.fixed_fee += v;
    else if (/shipping/.test(desc)) amounts.shipping += v;
    else amounts.other += v;
  }
  const tot = flat.match(/\bTotal\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  const baseAmt = tot ? Number(tot[1].replace(/,/g, "")) : baseSum;
  const gst = tot ? Number(tot[2].replace(/,/g, "")) : 0;
  const total = tot ? Number(tot[3].replace(/,/g, "")) : baseAmt + gst;
  const sign = credit ? -1 : 1;
  p.rows.push({
    number, doc_type: credit ? "credit_note" : "invoice", invoice_date: date, original_number: original,
    ads: sign * amounts.ads, commission: sign * amounts.commission, fixed_fee: sign * amounts.fixed_fee, shipping: sign * amounts.shipping, other: sign * amounts.other,
    base_amount: sign * baseAmt, gst: sign * gst, total: sign * total,
  });
  p.periodStart = p.periodEnd = date;
  if (Math.abs(baseSum - baseAmt) > 0.05) p.warnings.push(`Service lines add up to ${baseSum.toFixed(2)} but the total says ${baseAmt.toFixed(2)}.`);
  return p;
}
