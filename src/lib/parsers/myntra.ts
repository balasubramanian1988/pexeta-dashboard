// Myntra (PPMP marketplace, seller ships) reports → sd_my_ tables. Pure functions: no database access.
// Reports, as downloaded from the Myntra Partner Portal (Oct 2026):
//   MDirect Orders report     – one row per order line: status, prices, Myntra's margin ("gt charges"), dates
//   Settlement report ("SellerYearMonthWeekKey…xlsx") – sheets forward_settled / forward_unsettled / reverse_settled
//                                (per order line: seller product amount, commission, logistics, TCS/TDS, payout, UTR)
//                                and settled / unsettled_non_order_deduction (charges not tied to an order)
//   MDirect Returns report    – RTOs and customer returns with reasons
//   Myntra tax invoices (PDF) – ads ("Marketing Claim"), commission, logistics, subscription
import type { Parsed } from "./map";
import type { Table } from "./read";
import { istDate, num, parseTimestamp, str, type Cell } from "./util";

function base(type: Parsed["type"], table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}
function period(p: Parsed, dates: (string | null)[]) {
  const d = dates.filter(Boolean).sort() as string[];
  p.periodStart = d[0] ?? null;
  p.periodEnd = d[d.length - 1] ?? null;
}

/** Myntra writes blanks as "", '""', "null" or "1970-01-01". */
function clean(v: Cell): string {
  const s = str(v).replace(/^[\\"']+|[\\"']+$/g, "").trim();
  return s === "null" || s.startsWith("1970-01-01") ? "" : s;
}
/** "2026-09-19", "2026-09-29 00:00:00", "29-09-2026", Excel date → YYYY-MM-DD (India date for timestamps with an offset). */
function day(v: Cell): string | null {
  const d = dayRaw(v);
  return d && d >= "2000" ? d : null; // Myntra uses 1970-01-01 for "no date"
}
function dayRaw(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = clean(v);
  if (!s) return null;
  if (/T\d{2}:\d{2}.*[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : istDate(d); }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
/** IDs Excel has not turned into "1.00366E+11". */
const id = (v: Cell) => { const s = clean(typeof v === "number" ? Math.round(v) : v).replace(/^'/, ""); return /e\+/i.test(s) ? "" : s; };
const n = (v: Cell) => num(clean(v) as Cell);

export function myOrders(t: Table): Parsed {
  const p = base("my_orders", "sd_my_orders");
  for (const r of t.rows) {
    const line = id(r["order line id"]);
    const created = parseTimestamp(clean(r["created on"]).replace(/\.\d+$/, ""), true);
    if (!line || !created) continue;
    const sku = clean(r["seller sku code"]);
    p.rows.push({
      order_line_id: line,
      order_release_id: id(r["order release id"]), store_order_id: id(r["store order id"]), seller_order_id: clean(r["seller order id"]),
      created_at: created.toISOString(), order_date: istDate(created),
      sku, sku_id: id(r["sku id"]), style_id: id(r["style id"]), style_name: clean(r["style name"]).replace(/\s+/g, " "), article_type: clean(r["article type"]),
      status: clean(r["order status"]), cancellation_reason: clean(r["cancellation reason"]),
      final_amount: n(r["final amount"]), total_mrp: n(r["total mrp"]), discount: n(r["discount"]), coupon_discount: n(r["coupon discount"]),
      shipping_charge: n(r["shipping charge"]), seller_price: n(r["seller price"]), gt_charges: n(r["gt charges"]),
      shipped_on: day(r["shipped on"]), delivered_on: day(r["delivered on"]), cancelled_on: day(r["cancelled on"]),
      rto_date: day(r["rto creation date"]), return_date: day(r["return creation date"]), state: clean(r["state"]),
    });
    if (sku) p.products.push({ asin: sku, title: clean(r["style name"]).replace(/\s+/g, " "), mrp: n(r["total mrp"]) || null });
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

export function mySettlement(t: Table): Parsed {
  const p = base("my_settlement", "sd_my_settlement");
  const reverse = t.headers.some((h) => /Logistics_Cost_Reverse/i.test(h));
  for (const r of t.rows) {
    const line = id(r["order_line_id"]);
    const orderDate = day(r["order_date"]);
    if (!line || !orderDate) continue;
    const settled = n(r["Total_Settled_Amount"]);
    const settleDates = [day(r["settlement_date_postpaid_payment"]), day(r["settlement_date_prepaid_payment"])].filter(Boolean) as string[];
    p.rows.push({
      row_key: `${line}|${reverse ? "reverse" : "forward"}`, kind: reverse ? "reverse" : "forward",
      order_line_id: line, order_release_id: id(r["order_release_id"]), seller_order_id: clean(r["seller_order_id"]),
      order_date: orderDate, sku_id: id(r["sku_id"]), style_id: id(r["style_id"]),
      mrp: n(r["MRP"]), seller_discount: n(r["Seller_Discount"]), platform_discount: n(r["Platform_Discount"]),
      customer_paid: n(r["Customer_Paid_Amount"]), seller_product_amount: n(r["Total_Seller_Product_Amount"]),
      // Myntra shows commission as a negative (deduction) on sales and positive (given back) on returns: store it as a cost.
      commission: -n(r["Total_Commission"]), logistics: n(r["Total_Logistics_Cost"]),
      commission_pct: n(r["Commission_percent_incl_GST"]),
      tcs: n(r["tcs_amount_Postpaid"]) + n(r["tcs_amount_Prepaid"]), tds: n(r["tds_amount_Postpaid"]) + n(r["tds_amount_Prepaid"]),
      tax_rate: n(r["total_tax_rate"]), taxable_amount: n(r["taxable_amount"]),
      expected_settled: n(r["Expected_Settled_Amount_Postpaid"]) + n(r["Expected_Settled_Amount_Prepaid"]),
      settled, pending: n(r["Amount_pending_settlement_Postpaid"]) + n(r["Amount_pending_settlement_Prepaid"]),
      // Postpaid (cash on delivery) and prepaid amounts are paid separately, each with its own UTR.
      settled_postpaid: n(r["Settled_Amount_Postpaid"]), utr_postpaid: clean(r["UTR_Number_Postpaid"]) || null,
      settled_prepaid: n(r["Settled_Amount_Prepaid"]), utr_prepaid: clean(r["UTR_Number_Prepaid"]) || null,
      date_postpaid: day(r["settlement_date_postpaid_payment"]), date_prepaid: day(r["settlement_date_prepaid_payment"]),
      settlement_date: settleDates.sort().pop() ?? null,
      delivery_date: day(r["delivery_date"]), return_date: day(r["return_date"]), return_type: clean(r["return_type"]),
      zone: clean(r["shipment_zone_classification"]),
    });
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

export function myDeductions(t: Table): Parsed {
  const p = base("my_deductions", "sd_my_deductions");
  for (const r of t.rows) {
    const ref = clean(r["Invoice_Ref"]);
    if (!ref) continue;
    p.rows.push({
      invoice_ref: ref, amount: n(r["Settlement_Amount"]), settlement_type: clean(r["Settlement_Type"]),
      utr: clean(r["UTR"]) || null, settlement_date: day(r["Settlement_Date"]), description: clean(r["Settlement_Description"]),
    });
  }
  period(p, p.rows.map((x) => x.settlement_date as string | null));
  return p;
}

export function myReturns(t: Table): Parsed {
  const p = base("my_returns", "sd_my_returns");
  for (const r of t.rows) {
    const line = id(r["order_line_id"]);
    const status = clean(r["status"]);
    if (!line || !status) continue;
    p.rows.push({
      row_key: `${line}|${status}`, order_line_id: line, status,
      sku: clean(r["seller_sku_code"]), order_date: day(r["order_created_date"]),
      delivered_date: day(r["order_delivered_date"]), return_created_date: day(r["return_created_date"]),
      rto_date: day(r["order_rto_date"]), refunded_date: day(r["refunded_date"]),
      quantity: n(r["quantity"]) || 1, return_reason: clean(r["return_reason"]), return_mode: clean(r["return_mode"]),
    });
  }
  period(p, p.rows.map((x) => (x.return_created_date || x.rto_date || x.order_date) as string | null));
  return p;
}

/** Myntra tax invoice (PDF): ads ("Marketing Claim"), commission, logistics or subscription. */
export function myInvoice(text: string, fileName: string): Parsed {
  const p = base("my_invoice", "sd_my_invoices");
  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const number = pick(/Invoice No\s*:\s*(\S+)/);
  const date = pick(/Invoice Date\s*:\s*(\d{4}-\d{2}-\d{2})/);
  const invPeriod = pick(/Invoice Period\s*:\s*(\d{4}-\d{2})/);
  const totalLine = text.split("\n").find((l) => /^\s*Total\s+[\d.]+\s+Rs/.test(l)) ?? "";
  const amounts = [...totalLine.matchAll(/Rs\s*([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));
  // Columns on the Total line: unit price, base price, IGST, CGST, SGST, total.
  const baseAmt = amounts[1] ?? 0, gst = (amounts[2] ?? 0) + (amounts[3] ?? 0) + (amounts[4] ?? 0), total = amounts[5] ?? baseAmt + gst;
  const flat = text.replace(/\s+/g, " ");
  const category = /Marketing Claim|Self Service/i.test(flat) ? "Ads" : /Commission/i.test(flat) || /COMMISSION/.test(fileName) ? "Commission"
    : /Fixed_Fees|Shipping_Charges|LOGISTICS/i.test(flat + fileName) ? "Logistics" : /MDirect/i.test(flat) ? "Subscription" : "Other";
  // Which month the charge is for: "Marketing Claim-Aug 2026", "MDirect Aug 26", "Commission_2026-09", else the invoice period.
  const MON = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  let month = "";
  const w = flat.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20)?(\d{2})\b/i);
  const iso = flat.match(/_(\d{4})-(\d{2})\b/);
  if (w) month = `20${w[3]}-${String(MON.indexOf(w[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-01`;
  else if (iso) month = `${iso[1]}-${iso[2]}-01`;
  else if (invPeriod) month = `${invPeriod}-01`;
  if (!number || !date) { p.warnings.push("Could not read the invoice number or date."); return p; }
  const desc = (flat.match(/(Marketing Claim-? ?\w+ \d{4}|Self Service \S+|Commission_ ?\d{4}- ?\d{2}|Fixed_Fees_\d{4}-\d{2}|MDirect \w+ \d{2})/)?.[1] ?? category).replace(/\s+/g, " ");
  p.rows.push({ number, invoice_date: date, charge_month: month || `${date.slice(0, 7)}-01`, category, description: desc, base_amount: baseAmt, gst, total });
  p.periodStart = p.periodEnd = date;
  if (Math.abs(baseAmt + gst - total) > 0.05) p.warnings.push(`Base + GST (${(baseAmt + gst).toFixed(2)}) does not equal the total (${total.toFixed(2)}).`);
  return p;
}
