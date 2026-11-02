// FirstCry (marketplace / dropship) reports → sd_fc_ tables. Pure functions: no database access.
// Reports, as downloaded from the FirstCry vendor panel (Oct 2026):
//   Sales report ("dashboardsale_<from>_to_<to>.xlsx")   – one line per order item, at MRP
//   Vendor Reconciliation ("VendorReconciliation….xlsx") – one row per unit: base cost paid, invoice, payment advice, RTO / return debits
//   Sale Return data ("SaleReturnData_….xlsx")           – customer returns with reasons
//   All Product data ("AllProductData_….xlsx")           – product list: name, style code, MRP, GST rate, status
import type { Parsed } from "./map";
import type { Table } from "./read";
import { calendarDate, istDate, num, parseTimestamp, shortName, str, type Cell } from "./util";

function base(type: Parsed["type"], table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}

function period(p: Parsed, dates: (string | null)[]) {
  const d = dates.filter(Boolean).sort() as string[];
  p.periodStart = d[0] ?? null;
  p.periodEnd = d[d.length - 1] ?? null;
}

/** "-" and blanks mean "no style code" in FirstCry files. */
const style = (v: Cell) => { const s = str(v); return s === "-" ? "" : s; };
/** Product IDs arrive as numbers in some files and text in others. */
const pid = (v: Cell) => str(typeof v === "number" ? Math.round(v) : v);
/** "29/09/2026", "2026-10-01" or an Excel date → YYYY-MM-DD, or null. */
const day = (v: Cell) => (v === null || v === undefined || str(v) === "" ? null : calendarDate(v));
const blankToNull = (v: Cell) => { const s = str(v); return s === "" ? null : s; };

/** Numbers repeats of the same key within one file: "a", "a" → "a|1", "a|2". Stable across overlapping downloads. */
function keyer() {
  const seen = new Map<string, number>();
  return (k: string) => { const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return `${k}|${n}`; };
}

export function fcSales(t: Table): Parsed {
  const p = base("fc_sales", "sd_fc_sales");
  const key = keyer();
  for (const r of t.rows) {
    const poid = str(r["POID"]);
    const product = pid(r["ProductID"]);
    const at = r["OrderDate"] instanceof Date ? (r["OrderDate"] as Date) : parseTimestamp(str(r["OrderDate"]), true);
    if (!poid || !product || !at) continue;
    const sc = style(r["VendorStyleCode"]);
    p.rows.push({
      row_key: key(`${poid}|${product}`),
      poid, product_id: product,
      order_at: at.toISOString(), order_date: istDate(at),
      quantity: num(r["Quantity"]), mrp: num(r["MRP"]), mrp_sales: num(r["MRP Sales"]),
      category: str(r["categoryname"]), subcategory: str(r["subcategoryname"]), style_code: sc,
    });
    p.products.push({ asin: product, title: "", mrp: num(r["MRP"]) || null });
    if (sc) p.skus.push({ sku: sc, asin: product, fulfillment: "Dropship" });
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

export function fcRecon(t: Table): Parsed {
  const p = base("fc_recon", "sd_fc_recon");
  const key = keyer();
  for (const r of t.rows) {
    const poitem = str(r["Poitem Ids"]);
    const product = pid(r["Product ID"]);
    const orderDate = day(r["Order Date"]);
    if (!poitem || !product || !orderDate) continue;
    const gstRate = num(r["CGST %"]) + num(r["SGST %"]) + num(r["IGST %"]);
    const gstAmount = num(r["CGST Amount"]) + num(r["SGST Amount"]) + num(r["IGST Amount"]);
    const sc = style(r["Vendor Style Code"]);
    p.rows.push({
      row_key: key(poitem),
      poid: str(r["Order Ids"]), poitem_id: poitem, fc_ref: str(r["FC Ref. no."]),
      product_id: product, style_code: sc,
      order_date: orderDate, ship_date: day(r["Shipping Date"]), delivery_date: day(r["Delivery date"]), return_date: day(r["SR/RTO date"]),
      quantity: num(r["Qty"]), mrp: num(r["MRP"]), base_cost: num(r["Base Cost"]), gross_amount: num(r["Gross Amount"]),
      gst_rate: gstRate, gst_amount: Math.round(gstAmount * 10000) / 10000, total: num(r["Total"]),
      vendor_invoice: blankToNull(r["Vendor Invoice no."]), payment_advice: blankToNull(r["Payment advice no"]), debit_note: blankToNull(r["Debit note no."]),
      awb: str(r["AWB No"]),
      sr_qty: num(r["SR Qty"]), sr_total: num(r["SR Total Amount"]), sr_gross: num(r["SR Gross Amount"]),
      rto_qty: num(r["RTO Qty"]), rto_total: num(r["RTO Total Amount"]), rto_gross: num(r["RTO Gross Amount"]),
    });
    p.products.push({ asin: product, title: "", mrp: num(r["MRP"]) || null });
    if (sc) p.skus.push({ sku: sc, asin: product, fulfillment: "Dropship" });
  }
  period(p, p.rows.map((x) => x.order_date as string));
  return p;
}

export function fcReturns(t: Table): Parsed {
  const p = base("fc_returns", "sd_fc_returns");
  const key = keyer();
  for (const r of t.rows) {
    const poid = str(r["POID"]);
    const product = pid(r["ProductID"]);
    const ret = day(r["Sales Return Date"]);
    if (!poid || !product || !ret) continue;
    p.rows.push({
      row_key: key(`${poid}|${product}|${ret}`),
      poid, product_id: product, order_date: day(r["Order Date"]), return_date: ret,
      quantity: num(r["Quantity"]), mrp: num(r["MRP"]),
      reason: str(r["Reason"]), sub_type: str(r["SubType Reason"]), sub_reason: str(r["Subreason"]),
      style_code: style(r["VendorStyleCode"]), awb: str(r["RPID/AWB"]),
    });
    const title = str(r["Product Name"]).replace(/\s*\(minqty:\d+\)\s*$/i, "");
    p.products.push({ asin: product, title, mrp: num(r["MRP"]) || null });
  }
  period(p, p.rows.map((x) => x.return_date as string));
  return p;
}

/** Product list: goes straight into sd_products (no rows of its own). */
export function fcProducts(t: Table): Parsed {
  const p = base("fc_products", "sd_products");
  for (const r of t.rows) {
    const product = pid(r["Productid"]);
    if (!product) continue;
    const title = str(r["ProductName"]);
    const sc = style(r["VendorStyleCode"]);
    p.products.push({
      asin: product, title, mrp: num(r["MRP"]) || null,
      style_code: sc, gst_rate: str(r["GST"]) === "" ? null : num(r["GST"]),
      status: str(r["Product Status"]), category: str(r["Category Name"]),
    });
    if (sc) p.skus.push({ sku: sc, asin: product, fulfillment: "Dropship" });
  }
  if (!p.products.length) p.warnings.push("No products found in the file.");
  return p;
}

export { shortName };

/** FirstCry Ads (Campaigns › Product Ads performance). One row per month in the summary download, or per day
 *  in the day-wise one; a product or campaign column, when present, splits spend further. */
export function fcAds(t: Table): Parsed {
  const p = base("fc_ads", "sd_fc_ads");
  const has = (c: string) => t.headers.some((h) => h.trim().toLowerCase() === c);
  const col = (...names: string[]) => t.headers.find((h) => names.includes(h.trim().toLowerCase()));
  const dayCol = col("date", "day");
  const monthCol = col("month");
  const grain = dayCol ? "day" : "month";
  const dateCol = dayCol ?? monthCol;
  const productCol = col("product id", "productid", "product_id", "sku id", "sku");
  const campaignCol = col("campaign name", "campaign", "campaign id");
  if (!dateCol) { p.warnings.push("No Date or Month column in this ads report."); return p; }
  if (!has("ad spend")) { p.warnings.push("No Ad Spend column in this ads report."); return p; }
  const key = keyer();
  for (const r of t.rows) {
    let d = day(r[dateCol]);
    if (!d) continue;
    if (grain === "month") d = `${d.slice(0, 7)}-01`;
    const product = productCol ? pid(r[productCol]) : "";
    const campaign = campaignCol ? str(r[campaignCol]) : "";
    p.rows.push({
      row_key: key(`${grain}|${d}|${product}|${campaign}`),
      grain, period_date: d, product_id: product, campaign,
      spend: num(r["Ad Spend"]), impressions: num(r["Ad Impressions"]), clicks: num(r["Ad Clicks"]),
      ad_sales: num(r["Ad MRP Sales"]), orders: num(r["Orders (SKU)"]),
    });
  }
  const dates = p.rows.map((x) => x.period_date as string).sort();
  p.periodStart = dates[0] ?? null;
  if (dates.length) {
    const last = dates[dates.length - 1];
    if (grain === "month") { const [y, m] = last.split("-").map(Number); p.periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
    else p.periodEnd = last;
  }
  return p;
}
