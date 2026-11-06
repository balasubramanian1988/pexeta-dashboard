-- ============================================================
--  Pexeta Seller Dashboard — Flipkart (marketplace, seller ships or Flipkart warehouse)
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

-- Seller Hub › Reports › Orders: one row per order item.
create table if not exists sd_fk_orders (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  order_item_id text not null,              -- without the "OI:" prefix
  order_id text not null,                   -- "OD…"
  ordered_at timestamptz,
  order_date date not null,
  status text not null default '',          -- DELIVERED, CANCELLED, RETURNED, RETURN_REQUESTED, READY_TO_SHIP, APPROVED, SHIPPED…
  fulfilment_type text not null default '', -- NON_FBF (seller ships) or FBF (Flipkart warehouse)
  sku text not null default '',
  fsn text not null default '',
  title text not null default '',
  quantity numeric not null default 1,
  cancelled_on date,
  cancellation_reason text not null default '',
  cancellation_sub_reason text not null default '',
  return_id text not null default '',
  return_reason text not null default '',
  return_sub_reason text not null default '',
  dispatched_on date,
  delivered_on date,
  dispatch_sla_breached boolean not null default false,
  primary key (account_id, order_item_id)
);
create index if not exists sd_fk_orders_date on sd_fk_orders (account_id, order_date);

-- Seller Hub › Reports › Tax reports › Sales report: one row per sale, return or cancellation event (GST invoice values).
create table if not exists sd_fk_sales (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- order item | event sub type | buyer invoice | n
  order_item_id text not null,
  order_id text not null default '',
  sku text not null default '',
  fsn text not null default '',
  event_type text not null default '',      -- Sale or Return
  event_sub_type text not null default '',  -- Sale, Return, Cancellation, Return Cancellation
  order_date date not null,
  invoice_id text not null default '',
  invoice_date date,
  quantity numeric not null default 0,
  price_before_discount numeric not null default 0,
  total_discount numeric not null default 0,   -- negative
  seller_share numeric not null default 0,     -- discount the seller funds (negative)
  bank_offer_share numeric not null default 0, -- discount from bank offers (negative)
  invoice_amount numeric not null default 0,   -- customer price incl. GST and shipping
  taxable_value numeric not null default 0,    -- excl. GST; negative on returns and cancellations
  gst_rate numeric not null default 0,
  gst_amount numeric not null default 0,
  tcs numeric not null default 0,
  tds numeric not null default 0,
  delivery_state text not null default '',
  shopsy boolean not null default false,
  primary key (account_id, row_key)
);
create index if not exists sd_fk_sales_date on sd_fk_sales (account_id, order_date);

-- Settlement report (Payments › Settlements), "Orders" sheet: one row per order item per payout.
-- An item can have several rows: the sale, a return reversal, late fee adjustments.
-- Flipkart stores the item id as a rounded number here, so rows are matched to orders by order id + SKU.
create table if not exists sd_fk_settlement (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- hash of the row
  neft_id text not null default '',
  neft_type text not null default '',       -- Prepaid or Postpaid (cash on delivery)
  payment_date date,
  order_id text not null,
  order_item_ref text not null default '',  -- item id as Flipkart's file gives it (rounded)
  line_key text not null,                   -- order id | SKU
  sku text not null default '',
  quantity numeric not null default 0,
  order_date date not null,
  dispatch_date date,
  settlement_value numeric not null default 0,  -- paid to the bank for this row
  sale_amount numeric not null default 0,       -- what the customer paid, incl. GST
  offer_amount numeric not null default 0,      -- total offer: Flipkart's and the seller's
  my_share numeric not null default 0,          -- the seller's part of the offer (negative)
  addons numeric not null default 0,
  marketplace_fee numeric not null default 0,   -- excl. GST, negative = charge
  commission numeric not null default 0,
  fixed_fee numeric not null default 0,
  collection_fee numeric not null default 0,
  pick_pack_fee numeric not null default 0,
  shipping_fee numeric not null default 0,
  reverse_shipping_fee numeric not null default 0,
  other_fees numeric not null default 0,
  tcs numeric not null default 0,
  tds numeric not null default 0,
  gst_on_fees numeric not null default 0,
  offer_adjustment numeric not null default 0,
  protection_fund numeric not null default 0,
  refund numeric not null default 0,            -- sale taken back on a return (negative)
  commission_rate numeric not null default 0,
  return_type text not null default '',         -- Logistics Return (RTO) or Customer Return
  item_return_status text not null default '',
  shipping_zone text not null default '',
  invoice_id text not null default '',
  primary key (account_id, row_key)
);
create index if not exists sd_fk_settlement_date on sd_fk_settlement (account_id, order_date);
create index if not exists sd_fk_settlement_line on sd_fk_settlement (account_id, line_key);

-- Settlement report, sheets not tied to an order: Ads (wallet top-ups), storage, fines, services, TCS recovery…
create table if not exists sd_fk_settlement_other (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,
  sheet text not null,                      -- the sheet's name, e.g. Ads
  neft_id text not null default '',
  payment_date date,
  type text not null default '',            -- e.g. topup, redeem
  reference text not null default '',       -- campaign or transaction id
  amount numeric not null default 0,        -- settlement value (negative = deducted from the payout)
  gst numeric not null default 0,
  primary key (account_id, row_key)
);

-- Seller Hub › Returns report: courier returns (RTO) and customer returns.
create table if not exists sd_fk_returns (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  return_id text not null,
  order_item_id text not null,
  return_type text not null default '',     -- courier_return (RTO) or customer_return
  status text not null default '',
  reason text not null default '',
  sub_reason text not null default '',
  requested_on date,
  approved_on date,
  completed_on date,
  sku text not null default '',
  quantity numeric not null default 1,
  condition text not null default '',
  primary key (account_id, return_id)
);

-- Flipkart Ads › Reports: campaign by day ("day"), and product (SKU) for a date range ("range").
create table if not exists sd_fk_ads (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,
  grain text not null,                      -- 'day' or 'range'
  period_start date not null,
  period_end date not null,
  campaign_id text not null default '',
  campaign text not null default '',
  sku text not null default '',
  product text not null default '',
  spend numeric not null default 0,         -- excl. GST
  views numeric not null default 0,
  clicks numeric not null default 0,
  units numeric not null default 0,         -- direct + indirect
  direct_units numeric not null default 0,
  revenue numeric not null default 0,       -- ad-attributed revenue
  primary key (account_id, row_key)
);
create index if not exists sd_fk_ads_date on sd_fk_ads (account_id, period_start);

-- Flipkart commission / tax invoices and credit notes (PDF).
create table if not exists sd_fk_invoices (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  number text not null,
  doc_type text not null,                   -- invoice or credit_note
  invoice_date date not null,
  original_number text not null default '',
  ads numeric not null default 0,           -- Ad Services Fee, excl. GST
  commission numeric not null default 0,
  fixed_fee numeric not null default 0,
  shipping numeric not null default 0,
  other numeric not null default 0,
  base_amount numeric not null default 0,   -- excl. GST; negative on credit notes
  gst numeric not null default 0,
  total numeric not null default 0,
  storage_path text not null default '',
  primary key (account_id, number)
);

alter table sd_fk_orders enable row level security;
alter table sd_fk_sales enable row level security;
alter table sd_fk_settlement enable row level security;
alter table sd_fk_settlement_other enable row level security;
alter table sd_fk_returns enable row level security;
alter table sd_fk_ads enable row level security;
alter table sd_fk_invoices enable row level security;
do $$
declare t text;
begin
  foreach t in array array['sd_fk_orders','sd_fk_sales','sd_fk_settlement','sd_fk_settlement_other','sd_fk_returns','sd_fk_ads','sd_fk_invoices']
  loop
    execute format('drop policy if exists "sd read" on %I', t);
    execute format('create policy "sd read" on %I for select using (sd_can_see_account(account_id))', t);
  end loop;
end $$;
