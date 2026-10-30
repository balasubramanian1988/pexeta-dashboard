-- ============================================================
--  Pexeta Seller Dashboard — Myntra (PPMP marketplace, seller ships)
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

-- MDirect Orders report: one row per order line.
create table if not exists sd_my_orders (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  order_line_id text not null,
  order_release_id text not null default '',
  store_order_id text not null default '',
  seller_order_id text not null default '',
  created_at timestamptz,
  order_date date not null,
  sku text not null default '',             -- seller SKU code
  sku_id text not null default '',          -- Myntra SKU id (used in settlement files)
  style_id text not null default '',
  style_name text not null default '',
  article_type text not null default '',
  status text not null default '',          -- C delivered, SH shipped, PK packed, F failed/cancelled, RTO
  cancellation_reason text not null default '',
  final_amount numeric not null default 0,  -- customer price incl. GST (MRP − seller discount)
  total_mrp numeric not null default 0,
  discount numeric not null default 0,
  coupon_discount numeric not null default 0,
  shipping_charge numeric not null default 0,
  seller_price numeric not null default 0,  -- what the seller is paid on before fees, incl. GST
  gt_charges numeric not null default 0,    -- Myntra's margin: final amount − seller price
  shipped_on date,
  delivered_on date,
  cancelled_on date,
  rto_date date,
  return_date date,
  state text not null default '',
  primary key (account_id, order_line_id)
);
create index if not exists sd_my_orders_date on sd_my_orders (account_id, order_date);

-- Settlement report: per order line, forward (sale) and reverse (return), settled or still pending.
create table if not exists sd_my_settlement (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- order line | forward / reverse
  kind text not null,                       -- forward or reverse
  order_line_id text not null,
  order_release_id text not null default '',
  seller_order_id text not null default '',
  order_date date not null,
  sku_id text not null default '',
  style_id text not null default '',
  mrp numeric not null default 0,
  seller_discount numeric not null default 0,
  platform_discount numeric not null default 0,
  customer_paid numeric not null default 0,
  seller_product_amount numeric not null default 0,  -- the seller's invoice value, incl. GST
  commission numeric not null default 0,             -- cost incl. GST (negative = given back on a return)
  logistics numeric not null default 0,              -- fixed fee and shipping, incl. GST
  commission_pct numeric not null default 0,
  tcs numeric not null default 0,
  tds numeric not null default 0,
  tax_rate numeric not null default 0,
  taxable_amount numeric not null default 0,
  expected_settled numeric not null default 0,
  settled numeric not null default 0,
  pending numeric not null default 0,
  settled_postpaid numeric not null default 0,  -- cash on delivery part
  utr_postpaid text,
  date_postpaid date,
  settled_prepaid numeric not null default 0,
  utr_prepaid text,
  date_prepaid date,
  settlement_date date,
  delivery_date date,
  return_date date,
  return_type text not null default '',
  zone text not null default '',
  primary key (account_id, row_key)
);
create index if not exists sd_my_settlement_date on sd_my_settlement (account_id, order_date);

-- Settlement charges not tied to an order (e.g. ads, adjustments).
create table if not exists sd_my_deductions (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  invoice_ref text not null,
  amount numeric not null default 0,
  settlement_type text not null default '',
  utr text,
  settlement_date date,
  description text not null default '',
  primary key (account_id, invoice_ref)
);

-- MDirect Returns report: RTOs and customer returns.
create table if not exists sd_my_returns (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- order line | status
  order_line_id text not null,
  status text not null,                     -- RTO or Return
  sku text not null default '',
  order_date date,
  delivered_date date,
  return_created_date date,
  rto_date date,
  refunded_date date,
  quantity numeric not null default 1,
  return_reason text not null default '',
  return_mode text not null default '',
  primary key (account_id, row_key)
);

-- Myntra tax invoices (PDF): ads ("Marketing Claim"), commission, logistics, subscription.
create table if not exists sd_my_invoices (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  number text not null,
  invoice_date date not null,
  charge_month date not null,               -- the month the charge is for
  category text not null,                   -- Ads, Commission, Logistics, Subscription, Other
  description text not null default '',
  base_amount numeric not null default 0,   -- excl. GST
  gst numeric not null default 0,
  total numeric not null default 0,
  storage_path text not null default '',
  primary key (account_id, number)
);

alter table sd_my_orders enable row level security;
alter table sd_my_settlement enable row level security;
alter table sd_my_deductions enable row level security;
alter table sd_my_returns enable row level security;
alter table sd_my_invoices enable row level security;
do $$
declare t text;
begin
  foreach t in array array['sd_my_orders','sd_my_settlement','sd_my_deductions','sd_my_returns','sd_my_invoices']
  loop
    execute format('drop policy if exists "sd read" on %I', t);
    execute format('create policy "sd read" on %I for select using (sd_can_see_account(account_id))', t);
  end loop;
end $$;

-- Myntra ads by style ("Styles - Page 1.csv"). No dates in the file: linked to the ads invoice with the same total.
create table if not exists sd_my_ads_styles (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- report | style
  report_key text not null,                 -- fingerprint of the file's rows
  report_total numeric not null default 0,  -- total spend in the file
  style_id text not null,
  style_name text not null default '',
  spend numeric not null default 0,
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  units numeric not null default 0,
  revenue numeric not null default 0,       -- ad-attributed revenue (direct + indirect)
  direct_revenue numeric not null default 0,
  primary key (account_id, row_key)
);
alter table sd_my_ads_styles enable row level security;
drop policy if exists "sd read" on sd_my_ads_styles;
create policy "sd read" on sd_my_ads_styles for select using (sd_can_see_account(account_id));
