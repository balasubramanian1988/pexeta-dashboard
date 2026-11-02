// Recognises which marketplace report a file is from its column headers (Amazon, FirstCry).

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
  | "tax_document"
  | "fc_sales"
  | "fc_recon"
  | "fc_returns"
  | "fc_products"
  | "fc_ads"
  | "my_orders"
  | "my_settlement"
  | "my_deductions"
  | "my_returns"
  | "my_invoice"
  | "my_ads_styles"
  | "my_styles";

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
  fc_sales: "FirstCry: Sales report",
  fc_recon: "FirstCry: Vendor Reconciliation",
  fc_returns: "FirstCry: Sale Return data",
  fc_products: "FirstCry: All Product data",
  fc_ads: "FirstCry Ads: Product Ads performance",
  my_orders: "Myntra: Orders report",
  my_settlement: "Myntra: Settlement report",
  my_deductions: "Myntra: Settlement non-order deductions",
  my_returns: "Myntra: Returns report",
  my_invoice: "Myntra tax invoice (ads, commission, logistics)",
  my_ads_styles: "Myntra: Ads by style",
  my_styles: "Myntra: Style dashboard (product list)",
};

export const AMAZON_REPORTS: ReportType[] = ["unified_transactions", "orders", "business_child", "fba_inventory", "listings", "sp_advertised", "sd_advertised", "sb_keyword", "sb_purchases", "returns", "mtr_b2c", "mtr_b2b", "stock_transfer", "tax_document"];
export const FIRSTCRY_REPORTS: ReportType[] = ["fc_sales", "fc_recon", "fc_returns", "fc_products", "fc_ads"];
export const MYNTRA_REPORTS: ReportType[] = ["my_orders", "my_settlement", "my_deductions", "my_returns", "my_invoice", "my_ads_styles", "my_styles"];

/** Which marketplace a report belongs to, so an Amazon file is never saved into a FirstCry account (or the other way round). */
export function reportMarketplace(t: ReportType): "Amazon" | "FirstCry" | "Myntra" {
  return FIRSTCRY_REPORTS.includes(t) ? "FirstCry" : MYNTRA_REPORTS.includes(t) ? "Myntra" : "Amazon";
}

/** Snapshot reports with no date column need a report date from the uploader. */
export const NEEDS_REPORT_DATE: ReportType[] = ["business_child", "fba_inventory", "listings"];

export type Detection = { type: ReportType } | { type: null; reason: string };

export function detectTable(headers: string[]): Detection {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  const has = (...cols: string[]) => cols.every((c) => h.has(c.toLowerCase()));

  // Myntra
  if (has("order release id", "order line id", "seller price", "gt charges")) return { type: "my_orders" };
  if (has("order_release_id", "total_settled_amount", "order_line_id")) return { type: "my_settlement" };
  if (has("seller_name", "settlement_amount", "invoice_ref")) return { type: "my_deductions" };
  if (has("order_line_id", "order_rto_date", "return_reason")) return { type: "my_returns" };
  if (has("style", "style id", "spend", "impressions", "roi")) return { type: "my_ads_styles" };
  if (has("style id", "sellerskucode", "seller mrp", "listing status")) return { type: "my_styles" };
  if (has("seller sku code", "inventory count", "sellable inventory count"))
    return { type: null, reason: "Myntra inventory report: not used. Its counts are listed quantities, not a stock count." };
  if (has("customer_paid_amount", "commission_pct_incl_gst", "invoice_number") || has("sale_order_code", "taxable_amount", "invoice_number"))
    return { type: null, reason: "Myntra GST report: not needed for the dashboard yet (it will feed a Myntra GST tab later)." };

  // FirstCry
  if (has("poitem ids", "base cost", "payment advice no")) return { type: "fc_recon" };
  if (has("sales return date", "poid", "reason", "subreason")) return { type: "fc_returns" };
  if (has("poid", "orderdate", "productid", "mrp sales")) return { type: "fc_sales" };
  if (has("productid", "vendorstylecode", "productname", "gst")) return { type: "fc_products" };
  if (has("ad spend", "ad impressions", "ad mrp sales")) return { type: "fc_ads" };
  if (has("transaction id", "wallet name", "transaction type", "amount"))
    return { type: null, reason: "FirstCry Ads wallet log: it shows top-ups, not spend. Upload the Product Ads performance report instead." };

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
  if (/MYNTRA DESIGNS/i.test(text) && /Tax Invoice/i.test(text) && /Invoice No\s*:/i.test(text)) return { type: "my_invoice" };
  if (/Amazon Seller Services/i.test(text) && /(Tax Invoice|Credit Note)/i.test(text) && /Total Invoice amount/i.test(text))
    return { type: "tax_document" };
  return { type: null, reason: "PDF is not an Amazon or Myntra tax invoice." };
}
