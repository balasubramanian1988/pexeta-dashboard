// Maps each recognised report into rows for its sd_ table. Pure functions: no database access.
import type { ReportType } from "./detect";
import type { Table } from "./read";
import { fcProducts, fcRecon, fcReturns, fcSales } from "./firstcry";
import {
  calendarDate, istDate, istMonth, num, parseTimestamp, parseUnifiedDate, parseUsDate, pct, rowHasher, shortName, str, type Row,
} from "./util";

export type DbRow = Record<string, string | number | boolean | null | string[]>;

export type Parsed = {
  type: ReportType;
  table: string;              // target sd_ table, without account_id (added on save)
  rows: DbRow[];
  periodStart: string | null;
  periodEnd: string | null;
  // Product details. FirstCry's product list also carries style code, GST rate, status and category.
  products: { asin: string; title: string; mrp?: number | null; style_code?: string; gst_rate?: number | null; status?: string; category?: string }[];
  skus: { sku: string; asin: string; fulfillment: string }[];
  warnings: string[];
};

type Ctx = { reportDate: string | null; fileName: string };

function period(dates: (string | null)[]) {
  const d = dates.filter(Boolean).sort() as string[];
  return { periodStart: d[0] ?? null, periodEnd: d[d.length - 1] ?? null };
}

function base(type: ReportType, table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}

function needDate(ctx: Ctx, p: Parsed): string | null {
  if (!ctx.reportDate) p.warnings.push("This report has no date column. Choose the report date before uploading.");
  return ctx.reportDate;
}

// ---------- Orders ----------
function orders(t: Table): Parsed {
  const p = base("orders", "sd_orders");
  for (const r of t.rows) {
    const at = parseTimestamp(str(r["purchase-date"]));
    if (!at || !str(r["amazon-order-id"])) continue;
    const sku = str(r["sku"]);
    const itemId = str(r["order-item-id"]);
    p.rows.push({
      order_item_key: [str(r["amazon-order-id"]), itemId || sku].join("|"),
      amazon_order_id: str(r["amazon-order-id"]),
      purchase_at: at.toISOString(),
      purchase_date: istDate(at),
      order_status: str(r["order-status"]),
      item_status: str(r["item-status"]),
      fulfillment: str(r["fulfillment-channel"]) === "Amazon" ? "AFN" : "MFN",
      sku,
      asin: str(r["asin"]),
      quantity: num(r["quantity"]),
      item_price: num(r["item-price"]),
      item_tax: num(r["item-tax"]),
      promo_discount: num(r["item-promotion-discount"]),
      ship_state: str(r["ship-state"]),
      is_business: str(r["is-business-order"]).toLowerCase() === "true",
    });
    if (sku && str(r["asin"])) p.skus.push({ sku, asin: str(r["asin"]), fulfillment: str(r["fulfillment-channel"]) === "Amazon" ? "AFN" : "MFN" });
  }
  Object.assign(p, period(p.rows.map((x) => x.purchase_date as string)));
  return p;
}

// ---------- Active Listings ----------
function listings(t: Table, ctx: Ctx): Parsed {
  const p = base("listings", "sd_listings");
  const fromName = ctx.fileName.match(/(\d{2})-(\d{2})-(\d{4})/);
  // Amazon puts the download date in the file name (MM-DD-YYYY); prefer it over the date chosen at upload.
  const date = (fromName ? `${fromName[3]}-${fromName[1]}-${fromName[2]}` : null) ?? ctx.reportDate;
  if (!date) p.warnings.push("This report has no date column. Choose the report date before uploading.");
  for (const r of t.rows) {
    const sku = str(r["seller-sku"]);
    const asin = str(r["asin1"]);
    if (!sku || !asin) continue;
    const channel = str(r["fulfillment-channel"]);
    const q = str(r["quantity"]);
    p.rows.push({
      snapshot_date: date, sku, asin,
      title: str(r["item-name"]),
      price: r["price"] === "" ? null : num(r["price"]),
      quantity: q === "" ? null : num(q),
      channel,
      mrp: str(r["maximum-retail-price"]) === "" ? null : num(r["maximum-retail-price"]),
    });
    p.skus.push({ sku, asin, fulfillment: channel === "DEFAULT" ? "MFN" : "AFN" });
    p.products.push({ asin, title: str(r["item-name"]), mrp: str(r["maximum-retail-price"]) === "" ? null : num(r["maximum-retail-price"]) });
  }
  p.periodStart = p.periodEnd = date;
  return p;
}

// ---------- Manage FBA Inventory ----------
function fbaInventory(t: Table, ctx: Ctx): Parsed {
  const p = base("fba_inventory", "sd_inventory");
  const date = needDate(ctx, p);
  for (const r of t.rows) {
    const sku = str(r["sku"]);
    if (!sku) continue;
    p.rows.push({
      snapshot_date: date, sku, asin: str(r["asin"]),
      fulfillable: num(r["afn-fulfillable-quantity"]),
      reserved: num(r["afn-reserved-quantity"]),
      unsellable: num(r["afn-unsellable-quantity"]),
      inbound_working: num(r["afn-inbound-working-quantity"]),
      inbound_shipped: num(r["afn-inbound-shipped-quantity"]),
      inbound_receiving: num(r["afn-inbound-receiving-quantity"]),
    });
    p.skus.push({ sku, asin: str(r["asin"]), fulfillment: "AFN" });
    p.products.push({ asin: str(r["asin"]), title: str(r["product-name"]) });
  }
  p.periodStart = p.periodEnd = date;
  return p;
}

// ---------- Business report: Sales and Traffic by Child Item ----------
function businessChild(t: Table, ctx: Ctx): Parsed {
  const p = base("business_child", "sd_traffic");
  const date = needDate(ctx, p);
  for (const r of t.rows) {
    const asin = str(r["(Child) ASIN"]);
    if (!asin) continue;
    p.rows.push({
      date, asin,
      parent_asin: str(r["(Parent) ASIN"]),
      sessions: num(r["Sessions - Total"]),
      page_views: num(r["Page Views - Total"]),
      featured_offer_pct: pct(r["Featured Offer Percentage"]),
      units_ordered: num(r["Units Ordered"]),
      ordered_sales: num(r["Ordered Product Sales"]),
      order_items: num(r["Total Order Items"]),
    });
    p.products.push({ asin, title: str(r["Title"]) });
  }
  if (p.rows.length && p.rows.every((x) => x.sessions === 0))
    p.warnings.push("Sessions are 0 for every product. Amazon fills traffic in later: download this day again in the afternoon.");
  p.periodStart = p.periodEnd = date;
  return p;
}

// ---------- Custom Unified Transaction ----------
function unified(t: Table): Parsed {
  const p = base("unified_transactions", "sd_transactions");
  const hash = rowHasher();
  for (const r of t.rows) {
    const at = parseUnifiedDate(str(r["date/time"]));
    if (!at) continue;
    const raw = t.headers.map((h) => str(r[h]));
    const orderId = str(r["order id"]);
    p.rows.push({
      row_hash: hash(raw),
      posted_at: at.toISOString(),
      posted_date: istDate(at),
      settlement_id: str(r["settlement id"]),
      type: str(r["type"]),
      order_id: orderId === "---" ? "" : orderId,
      sku: str(r["Sku"] ?? r["sku"]),
      asin: "",
      description: str(r["description"]),
      quantity: num(r["quantity"]),
      fulfillment: str(r["fulfillment"]) === "Amazon" ? "AFN" : str(r["fulfillment"]) === "Merchant" ? "MFN" : "",
      account_type: str(r["account type"]),
      order_state: str(r["order state"]),
      product_sales: num(r["product sales"]),
      shipping_credits: num(r["shipping credits"]),
      gift_wrap_credits: num(r["gift wrap credits"]),
      promotional_rebates: num(r["promotional rebates"]),
      tax_liable: num(r["Total sales tax liable(GST before adjusting TCS)"]),
      tcs_cgst: num(r["TCS-CGST"]),
      tcs_sgst: num(r["TCS-SGST"]),
      tcs_igst: num(r["TCS-IGST"]),
      tds: num(r["TDS (Section 194-O)"]),
      selling_fees: num(r["selling fees"]),
      fba_fees: num(r["fba fees"]),
      other_transaction_fees: num(r["other transaction fees"]),
      other: num(r["other"]),
      total: num(r["total"]),
    });
  }
  Object.assign(p, period(p.rows.map((x) => x.posted_date as string)));
  return p;
}

// ---------- FBA Customer Returns ----------
function returns(t: Table): Parsed {
  const p = base("returns", "sd_returns");
  const hash = rowHasher();
  for (const r of t.rows) {
    const at = parseTimestamp(str(r["return-date"]));
    if (!at) continue;
    const lpn = str(r["license-plate-number"]);
    p.rows.push({
      row_key: lpn || hash(t.headers.map((h) => str(r[h]))),
      return_at: at.toISOString(),
      return_date: istDate(at),
      order_id: str(r["order-id"]),
      sku: str(r["sku"]),
      asin: str(r["asin"]),
      quantity: num(r["quantity"]),
      fc: str(r["fulfillment-center-id"]),
      disposition: str(r["detailed-disposition"]),
      reason: str(r["reason"]),
      comments: str(r["customer-comments"]).replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
    });
    if (str(r["sku"]) && str(r["asin"])) p.skus.push({ sku: str(r["sku"]), asin: str(r["asin"]), fulfillment: "AFN" });
  }
  Object.assign(p, period(p.rows.map((x) => x.return_date as string)));
  return p;
}

// ---------- Ads ----------
type AdKey = string;
function addAd(map: Map<AdKey, DbRow>, row: DbRow) {
  const key = [row.date, row.ad_type, row.campaign, row.ad_group, row.target, row.asin].join("␟");
  const prev = map.get(key);
  if (!prev) return void map.set(key, row);
  for (const k of ["impressions", "clicks", "spend", "sales", "orders", "units"] as const)
    prev[k] = Number(prev[k]) + Number(row[k]);
}

function spOrSd(t: Table, type: "SP" | "SD"): Parsed {
  const p = base(type === "SP" ? "sp_advertised" : "sd_advertised", "sd_ads");
  const map = new Map<AdKey, DbRow>();
  const salesCol = t.headers.find((h) => /^(7|14) Day Total Sales/.test(h) && !h.includes("Click")) ?? "";
  const ordersCol = t.headers.find((h) => /^(7|14) Day Total Orders/.test(h) && !h.includes("Click")) ?? "";
  const unitsCol = t.headers.find((h) => /^(7|14) Day Total Units/.test(h) && !h.includes("Click")) ?? "";
  for (const r of t.rows) {
    const date = calendarDate(r["Date"]);
    if (!date) continue;
    addAd(map, {
      date, ad_type: type,
      campaign: str(r["Campaign Name"]), ad_group: str(r["Ad Group Name"]), target: "",
      asin: str(r["Advertised ASIN"]), sku: str(r["Advertised SKU"]),
      impressions: num(r["Impressions"]), clicks: num(r["Clicks"]), spend: num(r["Spend"]),
      sales: num(r[salesCol]), orders: num(r[ordersCol]), units: num(r[unitsCol]),
    });
  }
  p.rows = [...map.values()];
  Object.assign(p, period(p.rows.map((x) => x.date as string)));
  return p;
}

function sbKeyword(t: Table): Parsed {
  const p = base("sb_keyword", "sd_ads");
  const map = new Map<AdKey, DbRow>();
  for (const r of t.rows) {
    const date = calendarDate(r["Date"]);
    if (!date) continue;
    addAd(map, {
      date, ad_type: "SB",
      campaign: str(r["Campaign Name"]), ad_group: str(r["Ad Group Name"]),
      target: [str(r["Targeting"]), str(r["Match Type"])].filter(Boolean).join(" · "),
      asin: "", sku: "",
      impressions: num(r["Impressions"]), clicks: num(r["Clicks"]), spend: num(r["Spend"]),
      sales: num(r["14 Day Total Sales (₹)"]), orders: num(r["14 Day Total Orders (#)"]), units: num(r["14 Day Total Units (#)"]),
    });
  }
  p.rows = [...map.values()];
  Object.assign(p, period(p.rows.map((x) => x.date as string)));
  return p;
}

function sbPurchases(t: Table): Parsed {
  const p = base("sb_purchases", "sd_sb_purchases");
  const map = new Map<string, DbRow>();
  for (const r of t.rows) {
    const date = calendarDate(r["Date"]) ?? parseUsDate(str(r["Date"]));
    const asin = str(r["Purchased ASIN"]);
    if (!date || !asin) continue;
    const row: DbRow = {
      date, campaign: str(r["Campaign Name"]), attribution: str(r["Attribution type"]), asin,
      sales: num(r["14 Day Total Sales (₹)"]), orders: num(r["14 Day Total Orders (#)"]), units: num(r["14 Day Total Units (#)"]),
    };
    const key = [date, row.campaign, row.attribution, asin].join("␟");
    const prev = map.get(key);
    if (prev) { prev.sales = Number(prev.sales) + Number(row.sales); prev.orders = Number(prev.orders) + Number(row.orders); prev.units = Number(prev.units) + Number(row.units); }
    else map.set(key, row);
  }
  p.rows = [...map.values()];
  Object.assign(p, period(p.rows.map((x) => x.date as string)));
  return p;
}

// ---------- GST: MTR B2C / B2B ----------
function mtr(t: Table, kind: "B2C" | "B2B"): Parsed {
  const p = base(kind === "B2C" ? "mtr_b2c" : "mtr_b2b", "sd_tax_lines");
  const hash = rowHasher();
  for (const r of t.rows) {
    const gstin = str(r["Seller Gstin"]);
    const inv = parseTimestamp(str(r["Invoice Date"]), true);
    if (!gstin || !inv) continue;
    const tcs = ["Tcs Cgst Amount", "Tcs Sgst Amount", "Tcs Utgst Amount", "Tcs Igst Amount"].reduce((s, c) => s + num(r[c]), 0);
    p.rows.push({
      row_hash: hash(t.headers.map((h) => str(r[h]))),
      kind, month: istMonth(inv), seller_gstin: gstin,
      invoice_number: str(r["Invoice Number"]),
      invoice_date: istDate(inv),
      transaction_type: str(r["Transaction Type"]),
      order_id: str(r["Order Id"]),
      quantity: num(r["Quantity"]),
      asin: str(r["Asin"]), sku: str(r["Sku"]), hsn: str(r["Hsn/sac"]),
      ship_from_state: str(r["Ship From State"]), ship_to_state: str(r["Ship To State"]),
      taxable_value: num(r["Tax Exclusive Gross"]),
      total_tax: num(r["Total Tax Amount"]),
      cgst: num(r["Cgst Tax"]) + num(r["Shipping Cgst Tax"]) + num(r["Gift Wrap Cgst Tax"]),
      sgst: num(r["Sgst Tax"]) + num(r["Utgst Tax"]) + num(r["Shipping Sgst Tax"]) + num(r["Shipping Utgst Tax"]) + num(r["Gift Wrap Sgst Tax"]) + num(r["Gift Wrap Utgst Tax"]),
      igst: num(r["Igst Tax"]) + num(r["Shipping Igst Tax"]) + num(r["Gift Wrap Igst Tax"]),
      cess: num(r["Compensatory Cess Tax"]),
      tcs,
      gst_rate: Math.round((num(r["Igst Rate"]) + num(r["Cgst Rate"]) + num(r["Sgst Rate"]) + num(r["Utgst Rate"])) * 1000) / 1000,
      buyer_gstin: str(r["Customer Bill To Gstid"]),
    });
  }
  // An MTR covers one return month, but refunds and cancellations carry the original invoice's date
  // (often an earlier month). File every line under the report's month: the month most shipments fall in.
  const month = reportMonth(p.rows);
  for (const x of p.rows) x.month = month;
  if (p.rows.some((x) => String(x.invoice_date).slice(0, 7) !== month.slice(0, 7)))
    p.warnings.push(`Some refunds and cancellations are for invoices from earlier months; they are filed under ${month.slice(0, 7)}, the month of this report.`);
  p.periodStart = month;
  p.periodEnd = endOfMonth(month);
  return p;
}

function reportMonth(rows: DbRow[]) {
  const n = new Map<string, number>();
  for (const r of rows) if (r.transaction_type === "Shipment" || r.transaction_type === "FC_TRANSFER") n.set(String(r.month), (n.get(String(r.month)) ?? 0) + 1);
  if (!n.size) for (const r of rows) n.set(String(r.month), (n.get(String(r.month)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
function endOfMonth(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

function stockTransfer(t: Table): Parsed {
  const p = base("stock_transfer", "sd_stock_transfers");
  const hash = rowHasher();
  for (const r of t.rows) {
    const inv = parseTimestamp(str(r["Invoice Date"]), true);
    if (!inv) continue;
    p.rows.push({
      row_hash: hash(t.headers.map((h) => str(r[h]))),
      month: istMonth(inv),
      supplier_gstin: str(r["Gstin Of Supplier"]), receiver_gstin: str(r["Gstin Of Receiver"]),
      transaction_type: str(r["Transaction Type"]),
      invoice_number: str(r["Invoice Number"]), invoice_date: istDate(inv),
      from_state: str(r["Ship From State"]), to_state: str(r["Ship To State"]),
      asin: str(r["Asin"]), sku: str(r["Sku"]), quantity: num(r["Quantity"]), hsn: str(r["Hsn Code"]),
      taxable_value: num(r["Taxable Value"]),
      igst: num(r["Igst Amount"]), cgst: num(r["Cgst Amount"]), sgst: num(r["Sgst Amount"]) + num(r["Utgst Amount"]),
    });
  }
  const month = reportMonth(p.rows);
  for (const x of p.rows) x.month = month;
  p.periodStart = month;
  p.periodEnd = endOfMonth(month);
  return p;
}

// ---------- GST: Amazon tax invoices and credit notes (PDF) ----------
function amount(s: string | undefined): number {
  if (!s) return 0;
  const neg = /-\s*INR/.test(s) || s.trim().startsWith("-");
  const v = num(s.replace(/-/g, ""));
  return neg ? -v : v;
}

export function taxDocument(text: string, fileName: string): Parsed {
  const p = base("tax_document", "sd_tax_documents");
  const isCredit = /Credit Note/i.test(text.slice(0, 1500));
  const number =
    text.match(/(?:Invoice|Credit Note) Number:\s*([A-Z]{2,4}-[A-Z0-9-]+)/)?.[1] ??
    fileName.match(/([A-Z]{2,4}-(?:C-)?\d{2,4}-\d+)/)?.[1] ?? "";
  const date = text.match(/(?:Invoice|Credit Note) Date:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1];
  const issuer = text.match(/GST Tax Registration No:\s*([0-9A-Z]{15})/)?.[1] ?? "";
  const seller = text.match(/GSTIN:\s*([0-9A-Z]{15})/)?.[1] ?? "";
  const pos = text.match(/Place of Supply:\s*([A-Z &]+)/)?.[1]?.trim() ?? "";
  // A label's amount is usually on the same line, but on some PDFs it sits on its own line
  // just above or below (the two text runs have slightly different baselines).
  const lines = text.split("\n");
  const AMT = /(-?\s*INR\s*-?[\d,]+(?:\.\d+)?)/;
  const onlyAmt = /^\s*(-?\s*INR\s*-?[\d,]+(?:\.\d+)?)\s*$/;
  const labelAmount = (label: RegExp): number | null => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return null;
    const same = lines[i].replace(label, "").match(AMT)?.[1];
    if (same) return amount(same);
    for (const j of [i - 1, i + 1]) {
      const m = lines[j]?.match(onlyAmt)?.[1];
      if (m) return amount(m);
    }
    return null;
  };
  const feesRead = labelAmount(/Subtotal of fees amount/i);
  const gstRead = labelAmount(/Subtotal of GST amount/i);
  const totalRead = labelAmount(/Total Invoice amount/i);
  const fees = feesRead ?? 0;
  const gst = gstRead ?? (totalRead !== null ? totalRead - fees : 0);
  const total = totalRead ?? fees + gst;
  const head = text.split(/Details of Fees/i)[0];
  const items = [...new Set([...head.matchAll(/\b99\d{4}\s{2,}([A-Za-z][A-Za-z &()\-:/]+?)(?:\s{2,}|\s*$)/gm)].map((m) => m[1].trim()))]
    .filter((x) => !/^(Total|IGST|CGST|SGST)$/i.test(x));
  if (!number || !date) {
    p.warnings.push("Could not read the document number or date.");
    return p;
  }
  const [d, m, y] = date.split("/");
  const iso = `${y}-${m}-${d}`;
  const category = /^ADS-/.test(number) || items.some((i) => /advertis/i.test(i)) ? "Advertising"
    : items.some((i) => /EasyShip|Easy Ship/i.test(i)) ? "Easy Ship fees"
    : items.some((i) => /FBA|Storage|Removal|Pick and Pack/i.test(i)) ? "FBA fees"
    : items.some((i) => /Closing|Listing|Technology|Refund Processing|Cancellation/i.test(i)) ? "Selling fees" : "Other fees";
  if (Math.abs(fees + gst - total) > 0.05) p.warnings.push(`Fees + GST (${(fees + gst).toFixed(2)}) do not equal the total (${total.toFixed(2)}).`);
  p.rows.push({
    number, doc_type: isCredit ? "credit_note" : "invoice", category,
    doc_date: iso, month: `${y}-${m}-01`,
    issuer_gstin: issuer, seller_gstin: seller, place_of_supply: pos,
    fees, gst, total,
    tax_split: /Subtotal for IGST/i.test(text) ? "IGST" : "CGST+SGST",
    items,
  });
  p.periodStart = p.periodEnd = iso;
  return p;
}

export function mapTable(type: ReportType, t: Table, ctx: Ctx): Parsed {
  switch (type) {
    case "orders": return orders(t);
    case "listings": return listings(t, ctx);
    case "fba_inventory": return fbaInventory(t, ctx);
    case "business_child": return businessChild(t, ctx);
    case "unified_transactions": return unified(t);
    case "returns": return returns(t);
    case "sp_advertised": return spOrSd(t, "SP");
    case "sd_advertised": return spOrSd(t, "SD");
    case "sb_keyword": return sbKeyword(t);
    case "sb_purchases": return sbPurchases(t);
    case "mtr_b2c": return mtr(t, "B2C");
    case "mtr_b2b": return mtr(t, "B2B");
    case "stock_transfer": return stockTransfer(t);
    case "tax_document": throw new Error("PDFs are mapped with taxDocument()");
    case "fc_sales": return fcSales(t);
    case "fc_recon": return fcRecon(t);
    case "fc_returns": return fcReturns(t);
    case "fc_products": return fcProducts(t);
  }
}

export { shortName };
export type { Row };
