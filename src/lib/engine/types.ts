// Row shapes the calculation engine works on (a subset of the sd_ table columns).

export type TxnRow = {
  posted_date: string;
  type: string;
  order_id: string;
  sku: string;
  description: string;
  quantity: number;
  product_sales: number;
  shipping_credits: number;
  gift_wrap_credits: number;
  promotional_rebates: number;
  tax_liable: number;
  tcs_cgst: number;
  tcs_sgst: number;
  tcs_igst: number;
  tds: number;
  selling_fees: number;
  fba_fees: number;
  other_transaction_fees: number;
  other: number;
  total: number;
  account_type?: string;
};

export type AdRow = { date: string; ad_type: "SP" | "SB" | "SD"; asin: string; spend: number; sales: number; clicks: number; impressions: number; orders: number; units: number; campaign: string };
export type SbPurchaseRow = { date: string; asin: string; sales: number; units: number };
export type SkuRow = { sku: string; asin: string; fulfillment?: string };
export type ProductRow = { asin: string; title: string; short_name: string };
export type ProductSetting = { asin: string; cost_pct: number | null; cost_per_unit: number | null; lead_time_days: number | null; warehouse_stock: number | null };
export type AccountDefaults = { default_cost_pct: number; default_lead_time_days: number; default_safety_days: number; plan_horizon_days: number };
export type InventoryRow = { sku: string; asin: string; fulfillable: number; reserved: number; inbound_working: number; inbound_shipped: number; inbound_receiving: number };
export type ListingRow = { sku: string; asin: string; quantity: number | null; channel: string };
