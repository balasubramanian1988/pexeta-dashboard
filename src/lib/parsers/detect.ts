// Recognises which Amazon report a file is from its column headers.

export type ReportType =
  | "orders"
  | "listings"
  | "fba_inventory"
  | "business_child"
  | "unified_transactions"
  | "returns"
  | "sp_advertised"
  | "sd_advertised"
  | "sb_keyword"
  | "sb_purchases"
  | "mtr_b2c"
  | "mtr_b2b"
  | "stock_transfer"
  | "tax_document";

export const REPORT_LABEL: Record<ReportType, string> = {
  orders: "All Orders",
  listings: "Active Listings",
  fba_inventory: "Manage FBA Inventory",
  business_child: "Sales and Traffic by Child Item",
  unified_transactions: "Custom Unified Transaction",
  returns: "FBA Customer Returns",
  sp_advertised: "Sponsored Products: advertised product",
  sd_advertised: "Sponsored Display: advertised product",
  sb_keyword: "Sponsored Brands: keyword",
  sb_purchases: "Sponsored Brands: attributed purchases",
  mtr_b2c: "MTR B2C (GST)",
  mtr_b2b: "MTR B2B (GST)",
  stock_transfer: "MTR Stock Transfer (GST)",
  tax_document: "Amazon tax invoice / credit note",
};

/** Snapshot reports with no date column need a report date from the uploader. */
export const NEEDS_REPORT_DATE: ReportType[] = ["business_child", "fba_inventory", "listings"];

export type Detection = { type: ReportType } | { type: null; reason: string };

export function detectTable(headers: string[]): Detection {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  const has = (...cols: string[]) => cols.every((c) => h.has(c.toLowerCase()));

  if (has("date/time", "settlement id", "type", "order id")) return { type: "unified_transactions" };
  if (has("transaction type", "total product charges", "amazon fees"))
    return { type: null, reason: "This is a daily statement summary. It has no SKU column, so upload the Custom Unified Transaction report instead." };
  if (has("amazon-order-id", "purchase-date", "item-price")) return { type: "orders" };
  if (has("seller-sku", "asin1", "item-name")) return { type: "listings" };
  if (has("sku", "asin", "afn-fulfillable-quantity")) return { type: "fba_inventory" };
  if (has("(child) asin", "sessions - total")) return { type: "business_child" };
  if (has("return-date", "order-id", "detailed-disposition")) return { type: "returns" };
  if (has("purchased asin", "attribution type")) return { type: "sb_purchases" };
  if (has("advertised asin", "viewable impressions")) return { type: "sd_advertised" };
  if (has("advertised asin", "spend")) return { type: "sp_advertised" };
  if (has("targeting", "match type", "spend") && h.has("viewable impressions")) return { type: "sb_keyword" };
  if (has("gstin of receiver", "gstin of supplier")) return { type: "stock_transfer" };
  if (has("seller gstin", "customer bill to gstid")) return { type: "mtr_b2b" };
  if (has("seller gstin", "invoice number", "tax exclusive gross")) return { type: "mtr_b2c" };
  return { type: null, reason: "Not a report the dashboard recognises. Check it is one of the reports on the upload checklist." };
}

export function detectPdf(text: string): Detection {
  if (/Amazon Seller Services/i.test(text) && /(Tax Invoice|Credit Note)/i.test(text) && /Total Invoice amount/i.test(text))
    return { type: "tax_document" };
  return { type: null, reason: "PDF is not an Amazon tax invoice or credit note." };
}
