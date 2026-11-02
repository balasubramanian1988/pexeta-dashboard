-- ============================================================
--  Pexeta Seller Dashboard (dashboard.pexeta.in) — database schema
--  Runs in the SAME Supabase project as Pexeta Ops (ops.pexeta.in).
--  Reuses: clients, marketplaces, team_members, current_member_id(), current_member_role().
--  Run AFTER pexeta-ops/supabase/schema.sql. Safe to run again.
--  All seller-dashboard tables are prefixed sd_.
-- ============================================================

-- ---------- Seller logins ----------
-- One row per seller user (Supabase email + password account) and the client they may see.
create table if not exists sd_client_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  can_edit_costs boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Who is signed in, and what they may see.
create or replace function sd_is_team() returns boolean
language sql stable security definer set search_path = public as $$
  -- Team members sign in with Google only; a password account using a team email is not team.
  select coalesce((auth.jwt() -> 'app_metadata' -> 'providers') ? 'google', false)
     and exists (select 1 from team_members where lower(email) = lower(auth.jwt() ->> 'email') and active)
$$;

create or replace function sd_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from sd_client_users where user_id = auth.uid() and active
$$;

create or replace function sd_can_see_client(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select sd_is_team() or c = sd_client_id()
$$;

-- ---------- Marketplace accounts and GST registrations ----------
create table if not exists sd_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  marketplace_id uuid not null references marketplaces(id),
  name text not null,                       -- e.g. "Root and Soil — Amazon.in"
  seller_id text not null default '',       -- Amazon merchant token, e.g. A20LNIW0086CNE
  default_cost_pct numeric not null default 0.25,  -- product cost as share of GST-inclusive selling price when the seller has not entered one
  default_lead_time_days int not null default 30,
  default_safety_days int not null default 7,
  plan_horizon_days int not null default 45,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists sd_accounts_client_marketplace on sd_accounts (client_id, marketplace_id);

create table if not exists sd_gstins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  gstin text not null unique,
  state text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Uploads (one row per file) ----------
create table if not exists sd_uploads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references sd_accounts(id) on delete cascade,
  report_type text not null,                -- see src/lib/parsers/types.ts
  file_name text not null,
  storage_path text not null,               -- private bucket sd-files
  report_date date,                         -- for snapshot reports without a date column
  period_start date,
  period_end date,
  rows_parsed int not null default 0,
  rows_saved int not null default 0,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  message text not null default '',
  uploaded_by uuid references team_members(id),
  created_at timestamptz not null default now()
);
create index if not exists sd_uploads_account_idx on sd_uploads(account_id, created_at desc);

-- ---------- Product master (ASIN level) and seller-editable settings ----------
create table if not exists sd_products (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  asin text not null,
  title text not null default '',
  short_name text not null default '',
  mrp numeric,
  primary key (account_id, asin)
);

create table if not exists sd_skus (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  sku text not null,
  asin text not null,
  fulfillment text not null default '',      -- AFN (FBA) or MFN (Easy Ship / self ship)
  primary key (account_id, sku)
);

create table if not exists sd_product_settings (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  asin text not null,
  cost_pct numeric,                          -- share of GST-inclusive selling price, e.g. 0.22
  cost_per_unit numeric,                     -- rupees; wins over cost_pct when set
  lead_time_days int,
  warehouse_stock int,                       -- seller's own warehouse stock, for the stock plan
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (account_id, asin)
);

-- ---------- Amazon data ----------
create table if not exists sd_orders (                -- All Orders report
  account_id uuid not null references sd_accounts(id) on delete cascade,
  order_item_key text not null,                        -- order id + sku (+ order-item-id when present)
  amazon_order_id text not null,
  purchase_at timestamptz not null,
  purchase_date date not null,                         -- IST
  order_status text not null default '',
  item_status text not null default '',
  fulfillment text not null default '',
  sku text not null default '',
  asin text not null default '',
  quantity int not null default 0,
  item_price numeric not null default 0,               -- GST-inclusive
  item_tax numeric not null default 0,
  promo_discount numeric not null default 0,
  ship_state text not null default '',
  is_business boolean not null default false,
  primary key (account_id, order_item_key)
);
create index if not exists sd_orders_date_idx on sd_orders(account_id, purchase_date);

create table if not exists sd_transactions (          -- Custom Unified Transaction report
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_hash text not null,
  posted_at timestamptz not null,
  posted_date date not null,                           -- IST
  settlement_id text not null default '',
  type text not null default '',
  order_id text not null default '',
  sku text not null default '',
  asin text not null default '',                       -- filled from sd_skus or by order id
  description text not null default '',
  quantity numeric not null default 0,
  fulfillment text not null default '',
  account_type text not null default '',
  order_state text not null default '',
  product_sales numeric not null default 0,            -- excluding GST
  shipping_credits numeric not null default 0,
  gift_wrap_credits numeric not null default 0,
  promotional_rebates numeric not null default 0,
  tax_liable numeric not null default 0,
  tcs_cgst numeric not null default 0,
  tcs_sgst numeric not null default 0,
  tcs_igst numeric not null default 0,
  tds numeric not null default 0,
  selling_fees numeric not null default 0,             -- including 18% GST
  fba_fees numeric not null default 0,
  other_transaction_fees numeric not null default 0,
  other numeric not null default 0,
  total numeric not null default 0,
  primary key (account_id, row_hash)
);
create index if not exists sd_transactions_date_idx on sd_transactions(account_id, posted_date);

create table if not exists sd_traffic (               -- Detail Page Sales and Traffic by Child Item
  account_id uuid not null references sd_accounts(id) on delete cascade,
  date date not null,
  asin text not null,
  parent_asin text not null default '',
  sessions int not null default 0,
  page_views int not null default 0,
  featured_offer_pct numeric not null default 0,
  units_ordered int not null default 0,
  ordered_sales numeric not null default 0,
  order_items int not null default 0,
  primary key (account_id, date, asin)
);

create table if not exists sd_ads (                   -- SP / SD advertised product, SB keyword reports
  account_id uuid not null references sd_accounts(id) on delete cascade,
  date date not null,
  ad_type text not null check (ad_type in ('SP', 'SB', 'SD')),
  campaign text not null default '',
  ad_group text not null default '',
  target text not null default '',                     -- SB keyword; empty for SP/SD
  asin text not null default '',                       -- empty for SB
  sku text not null default '',
  impressions int not null default 0,
  clicks int not null default 0,
  spend numeric not null default 0,                    -- excluding GST
  sales numeric not null default 0,                    -- attributed (7-day SP, 14-day SB/SD)
  orders int not null default 0,
  units int not null default 0,
  primary key (account_id, date, ad_type, campaign, ad_group, target, asin)
);

create table if not exists sd_sb_purchases (          -- Sponsored Brands attributed purchases
  account_id uuid not null references sd_accounts(id) on delete cascade,
  date date not null,
  campaign text not null,
  attribution text not null,
  asin text not null,
  sales numeric not null default 0,
  orders int not null default 0,
  units int not null default 0,
  primary key (account_id, date, campaign, attribution, asin)
);

create table if not exists sd_inventory (             -- Manage FBA Inventory snapshot
  account_id uuid not null references sd_accounts(id) on delete cascade,
  snapshot_date date not null,
  sku text not null,
  asin text not null,
  fulfillable int not null default 0,
  reserved int not null default 0,
  unsellable int not null default 0,
  inbound_working int not null default 0,
  inbound_shipped int not null default 0,
  inbound_receiving int not null default 0,
  primary key (account_id, snapshot_date, sku)
);

create table if not exists sd_listings (              -- Active Listings snapshot
  account_id uuid not null references sd_accounts(id) on delete cascade,
  snapshot_date date not null,
  sku text not null,
  asin text not null,
  title text not null default '',
  price numeric,
  quantity int,
  channel text not null default '',                   -- AMAZON_IN (FBA) or DEFAULT (merchant)
  mrp numeric,
  primary key (account_id, snapshot_date, sku)
);

create table if not exists sd_returns (               -- FBA Customer Returns
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                              -- license plate number, or a hash
  return_at timestamptz not null,
  return_date date not null,
  order_id text not null default '',
  sku text not null default '',
  asin text not null default '',
  quantity int not null default 0,
  fc text not null default '',
  disposition text not null default '',
  reason text not null default '',
  comments text not null default '',
  primary key (account_id, row_key)
);

-- ---------- GST ----------
create table if not exists sd_tax_lines (             -- MTR B2C and B2B
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_hash text not null,
  kind text not null check (kind in ('B2C', 'B2B')),
  month date not null,                                -- first day of the month
  seller_gstin text not null,
  invoice_number text not null default '',
  invoice_date date,
  transaction_type text not null default '',
  order_id text not null default '',
  quantity numeric not null default 0,
  asin text not null default '',
  sku text not null default '',
  hsn text not null default '',
  ship_from_state text not null default '',
  ship_to_state text not null default '',
  taxable_value numeric not null default 0,
  total_tax numeric not null default 0,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  cess numeric not null default 0,
  tcs numeric not null default 0,
  gst_rate numeric not null default 0,
  buyer_gstin text not null default '',
  primary key (account_id, row_hash)
);
create index if not exists sd_tax_lines_month_idx on sd_tax_lines(account_id, month, seller_gstin);

create table if not exists sd_stock_transfers (       -- MTR Stock Transfer
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_hash text not null,
  month date not null,
  supplier_gstin text not null default '',
  receiver_gstin text not null default '',
  transaction_type text not null default '',
  invoice_number text not null default '',
  invoice_date date,
  from_state text not null default '',
  to_state text not null default '',
  asin text not null default '',
  sku text not null default '',
  quantity numeric not null default 0,
  hsn text not null default '',
  taxable_value numeric not null default 0,
  igst numeric not null default 0,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  primary key (account_id, row_hash)
);

create table if not exists sd_tax_documents (         -- Amazon fee / ads tax invoices and credit notes (PDF)
  account_id uuid not null references sd_accounts(id) on delete cascade,
  number text not null,
  doc_type text not null check (doc_type in ('invoice', 'credit_note')),
  category text not null default '',                  -- selling fees, FBA fees, Easy Ship, ads, other
  doc_date date not null,
  month date not null,
  issuer_gstin text not null default '',
  seller_gstin text not null default '',
  place_of_supply text not null default '',
  fees numeric not null default 0,
  gst numeric not null default 0,
  total numeric not null default 0,
  tax_split text not null default '',                 -- IGST or CGST+SGST
  items text[] not null default '{}',
  storage_path text not null default '',
  primary key (account_id, number)
);

-- ---------- Row-level security ----------
-- Reads: team members see everything; seller users see only their own client's rows.
-- Writes: made only by the app's server (service role) after checking who is signed in.
do $$
declare t text;
begin
  foreach t in array array['sd_accounts','sd_uploads','sd_products','sd_skus','sd_product_settings','sd_orders',
    'sd_transactions','sd_traffic','sd_ads','sd_sb_purchases','sd_inventory','sd_listings','sd_returns',
    'sd_tax_lines','sd_stock_transfers','sd_tax_documents']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
alter table sd_client_users enable row level security;
alter table sd_gstins enable row level security;

drop policy if exists "sd own login" on sd_client_users;
create policy "sd own login" on sd_client_users for select using (sd_is_team() or user_id = auth.uid());

drop policy if exists "sd gstins" on sd_gstins;
create policy "sd gstins" on sd_gstins for select using (sd_can_see_client(client_id));

drop policy if exists "sd accounts" on sd_accounts;
create policy "sd accounts" on sd_accounts for select using (sd_can_see_client(client_id));

create or replace function sd_can_see_account(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select sd_is_team() or exists (select 1 from sd_accounts where id = a and client_id = sd_client_id())
$$;

do $$
declare t text;
begin
  foreach t in array array['sd_uploads','sd_products','sd_skus','sd_product_settings','sd_orders',
    'sd_transactions','sd_traffic','sd_ads','sd_sb_purchases','sd_inventory','sd_listings','sd_returns',
    'sd_tax_lines','sd_stock_transfers','sd_tax_documents']
  loop
    execute format('drop policy if exists "sd read" on %I', t);
    execute format('create policy "sd read" on %I for select using (sd_can_see_account(account_id))', t);
  end loop;
end $$;

-- Sellers may also read their own client's name, and marketplace names.
drop policy if exists "clients visible to own seller" on clients;
create policy "clients visible to own seller" on clients for select using (id = sd_client_id());
drop policy if exists "marketplaces visible to sellers" on marketplaces;
create policy "marketplaces visible to sellers" on marketplaces for select using (sd_client_id() is not null);

-- ---------- Private file storage ----------
insert into storage.buckets (id, name, public) values ('sd-files', 'sd-files', false)
on conflict (id) do nothing;
-- No storage policies are granted: files are read and written only by the server (service role),
-- which hands out short-lived signed URLs after checking access.

-- ---------- Starter data: Root and Soil pilot (edit if names differ) ----------
insert into clients (name) values ('Root and Soil') on conflict (name) do nothing;

insert into sd_accounts (client_id, marketplace_id, name, seller_id)
select c.id, m.id, 'Root and Soil — Amazon.in', 'A20LNIW0086CNE'
from clients c, marketplaces m
where c.name = 'Root and Soil' and m.name = 'Amazon'
  and not exists (select 1 from sd_accounts a where a.client_id = c.id and a.marketplace_id = m.id);

insert into sd_gstins (client_id, gstin, state)
select c.id, g.gstin, g.state
from clients c,
  (values ('33AALCR8246B1ZF', 'Tamil Nadu'), ('29AALCR8246B1Z4', 'Karnataka'), ('36AALCR8246B1Z9', 'Telangana'),
          ('27AALCR8246B1Z8', 'Maharashtra'), ('19AALCR8246B1Z5', 'West Bengal'), ('32AALCR8246B1ZH', 'Kerala')) as g(gstin, state)
where c.name = 'Root and Soil'
on conflict (gstin) do nothing;

-- ---------- FirstCry (also in 003_firstcry.sql for existing installs) ----------
-- Product list details (FirstCry "All Product Data"); also useful for other marketplaces.
alter table sd_products add column if not exists style_code text not null default '';
alter table sd_products add column if not exists gst_rate numeric;            -- e.g. 5, 18
alter table sd_products add column if not exists status text not null default '';
alter table sd_products add column if not exists category text not null default '';

-- FirstCry sales report (Dashboard › Sales): one row per order line, at MRP.
create table if not exists sd_fc_sales (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- POID | product | n (n = repeat within the order)
  poid text not null,
  product_id text not null,
  order_at timestamptz,
  order_date date not null,                 -- India date
  quantity numeric not null default 0,      -- 0 = cancelled
  mrp numeric not null default 0,
  mrp_sales numeric not null default 0,
  category text not null default '',
  subcategory text not null default '',
  style_code text not null default '',
  primary key (account_id, row_key)
);
create index if not exists sd_fc_sales_date on sd_fc_sales (account_id, order_date);

-- FirstCry Vendor Reconciliation: one row per unit, with what FirstCry pays (base cost + GST),
-- invoice, payment advice and debit notes for RTO / customer returns.
create table if not exists sd_fc_recon (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- PO item | n (one row per unit)
  poid text not null,
  poitem_id text not null,
  fc_ref text not null default '',
  product_id text not null,
  style_code text not null default '',
  order_date date not null,
  ship_date date,
  delivery_date date,
  return_date date,                         -- SR / RTO date
  quantity numeric not null default 0,
  mrp numeric not null default 0,
  base_cost numeric not null default 0,     -- what FirstCry pays per unit, excluding GST
  gross_amount numeric not null default 0,
  gst_rate numeric not null default 0,
  gst_amount numeric not null default 0,
  total numeric not null default 0,         -- including GST
  vendor_invoice text,
  payment_advice text,
  debit_note text,
  awb text not null default '',
  sr_qty numeric not null default 0,        -- customer returns
  sr_total numeric not null default 0,
  sr_gross numeric not null default 0,
  rto_qty numeric not null default 0,       -- returned to origin (not delivered)
  rto_total numeric not null default 0,
  rto_gross numeric not null default 0,
  primary key (account_id, row_key)
);
create index if not exists sd_fc_recon_date on sd_fc_recon (account_id, order_date);

-- FirstCry sales returns report: customer returns with reasons.
create table if not exists sd_fc_returns (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- POID | product | n
  poid text not null,
  product_id text not null,
  order_date date,
  return_date date not null,
  quantity numeric not null default 0,
  mrp numeric not null default 0,
  reason text not null default '',
  sub_type text not null default '',
  sub_reason text not null default '',
  style_code text not null default '',
  awb text not null default '',
  primary key (account_id, row_key)
);
create index if not exists sd_fc_returns_date on sd_fc_returns (account_id, return_date);

alter table sd_fc_sales enable row level security;
alter table sd_fc_recon enable row level security;
alter table sd_fc_returns enable row level security;
do $$
declare t text;
begin
  foreach t in array array['sd_fc_sales','sd_fc_recon','sd_fc_returns']
  loop
    execute format('drop policy if exists "sd read" on %I', t);
    execute format('create policy "sd read" on %I for select using (sd_can_see_account(account_id))', t);
  end loop;
end $$;

-- ---------- Myntra (also in 004_myntra.sql for existing installs) ----------
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

-- FirstCry Ads (also in 005_firstcry_ads.sql)

-- FirstCry Ads › Campaigns › Product Ads performance. The summary download has one row per month;
-- the day-wise download one row per day. Where a month has day-wise rows, the monthly row is ignored.
create table if not exists sd_fc_ads (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- grain | date | product | campaign | n
  grain text not null,                      -- 'month' or 'day'
  period_date date not null,                -- the day, or the first day of the month
  product_id text not null default '',      -- when the report is split by product
  campaign text not null default '',
  spend numeric not null default 0,
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  ad_sales numeric not null default 0,      -- ad-attributed sales at MRP
  orders numeric not null default 0,
  primary key (account_id, row_key)
);
create index if not exists sd_fc_ads_date on sd_fc_ads (account_id, period_date);
alter table sd_fc_ads enable row level security;
drop policy if exists "sd read" on sd_fc_ads;
create policy "sd read" on sd_fc_ads for select using (sd_can_see_account(account_id));

-- Amazon Brand Analytics (also in 006_brand_analytics.sql)

-- Search Query Performance, brand view: per search term, the whole market's funnel and the brand's part of it.
create table if not exists sd_ba_queries (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  grain text not null,                      -- 'week' (used for trends), 'month' or 'quarter'
  period_end date not null,                 -- Amazon's "Reporting Date": last day of the week or month
  query text not null,                      -- lower case
  score numeric not null default 0,
  volume numeric not null default 0,
  impr_total numeric not null default 0,
  impr_brand numeric not null default 0,
  click_total numeric not null default 0,
  click_brand numeric not null default 0,
  cart_total numeric not null default 0,
  cart_brand numeric not null default 0,
  purch_total numeric not null default 0,
  purch_brand numeric not null default 0,
  price_median numeric,
  brand_price_median numeric,
  primary key (account_id, grain, period_end, query)
);

-- Search Catalogue Performance: each ASIN's funnel from search, and how much of it had same-day / 1-day delivery.
create table if not exists sd_ba_asins (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  grain text not null,
  period_end date not null,
  asin text not null,
  impressions numeric not null default 0,
  impr_fast numeric not null default 0,     -- same-day + 1-day delivery
  clicks numeric not null default 0,
  cart_adds numeric not null default 0,
  purchases numeric not null default 0,
  purch_fast numeric not null default 0,
  sales numeric not null default 0,         -- search traffic sales, incl. GST
  price_median numeric,
  primary key (account_id, grain, period_end, asin)
);

-- Market Basket Analysis: the three products most often bought in the same order as each ASIN.
create table if not exists sd_ba_basket (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  grain text not null,
  period_end date not null,
  asin text not null,
  orders numeric not null default 0,
  with_asin_1 text not null default '',
  with_title_1 text not null default '',
  with_pct_1 numeric not null default 0,
  with_asin_2 text not null default '',
  with_title_2 text not null default '',
  with_pct_2 numeric not null default 0,
  with_asin_3 text not null default '',
  with_title_3 text not null default '',
  with_pct_3 numeric not null default 0,
  primary key (account_id, grain, period_end, asin)
);

alter table sd_ba_queries enable row level security;
alter table sd_ba_asins enable row level security;
alter table sd_ba_basket enable row level security;
drop policy if exists "sd read" on sd_ba_queries;
drop policy if exists "sd read" on sd_ba_asins;
drop policy if exists "sd read" on sd_ba_basket;
create policy "sd read" on sd_ba_queries for select using (sd_can_see_account(account_id));
create policy "sd read" on sd_ba_asins for select using (sd_can_see_account(account_id));
create policy "sd read" on sd_ba_basket for select using (sd_can_see_account(account_id));

-- Pexeta's work, from Pexeta Ops (also in 007_client_work.sql; needs the Ops tasks table)

-- Ops tasks gain a client view. Nothing is shown to a client unless the team ticks "Show to client".
alter table tasks add column if not exists client_visible boolean not null default false;
alter table tasks add column if not exists client_title text not null default '';      -- plain-language title for the seller
alter table tasks add column if not exists waiting_on_client boolean not null default false; -- blocked on the seller; the block reason is shown as "what we need"

-- What a brand may see of Pexeta's work: client-visible tasks only, in three plain states.
-- Completed means closed by the VP (the closure rule stays). Internal descriptions, owners and notes are never returned.
create or replace function sd_client_tasks(p_client uuid)
returns table (ref int, title text, marketplace text, state text, need text, due_date date, done_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.ref,
         coalesce(nullif(t.client_title, ''), t.title),
         coalesce(m.name, ''),
         case when t.status = 'closed' then 'completed'
              when t.status = 'blocked' and t.waiting_on_client then 'waiting'
              else 'in_progress' end,
         case when t.status = 'blocked' and t.waiting_on_client then t.blocked_reason else '' end,
         t.due_date, t.closed_at, t.updated_at
  from tasks t
  left join marketplaces m on m.id = t.marketplace_id
  where t.client_id = p_client
    and t.client_visible
    and (sd_is_team() or p_client = sd_client_id())
$$;
revoke all on function sd_client_tasks(uuid) from public;
grant execute on function sd_client_tasks(uuid) to authenticated;

-- Amazon FBA warehouse claims (also in 008_fba_claims.sql)

-- Inventory Ledger, detailed view: stock adjustments (lost, found, damaged, disposed), receipts, customer and vendor returns.
create table if not exists sd_inv_ledger (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,
  event_date date not null,                 -- India date
  event_type text not null,                 -- Adjustments, Receipts, CustomerReturns, VendorReturns
  fnsku text not null default '',
  asin text not null default '',
  sku text not null default '',
  reference_id text not null default '',
  quantity numeric not null default 0,
  fc text not null default '',
  disposition text not null default '',
  reason text not null default '',          -- Amazon's code: M lost, F found, E damaged at the warehouse, D disposed, P / Q disposition change
  reconciled numeric not null default 0,
  unreconciled numeric not null default 0,  -- lost units neither found nor reimbursed yet
  primary key (account_id, row_key)
);
create index if not exists sd_inv_ledger_date on sd_inv_ledger (account_id, event_date);

-- FBA Reimbursements: every payment (or replacement unit) Amazon has made.
create table if not exists sd_reimbursements (
  account_id uuid not null references sd_accounts(id) on delete cascade,
  row_key text not null,                    -- reimbursement id | sku | original reimbursement id
  approval_date date not null,
  reimbursement_id text not null,
  case_id text not null default '',
  order_id text not null default '',
  reason text not null default '',          -- CustomerReturn, CustomerServiceIssue, Lost_Warehouse, Damaged_Warehouse, …
  sku text not null default '',
  fnsku text not null default '',
  asin text not null default '',
  condition text not null default '',
  amount_per_unit numeric not null default 0,
  amount_total numeric not null default 0,
  qty_cash numeric not null default 0,
  qty_inventory numeric not null default 0,
  qty_total numeric not null default 0,
  original_id text not null default '',
  original_type text not null default '',
  primary key (account_id, row_key)
);
create index if not exists sd_reimbursements_date on sd_reimbursements (account_id, approval_date);

alter table sd_inv_ledger enable row level security;
alter table sd_reimbursements enable row level security;
drop policy if exists "sd read" on sd_inv_ledger;
drop policy if exists "sd read" on sd_reimbursements;
create policy "sd read" on sd_inv_ledger for select using (sd_can_see_account(account_id));
create policy "sd read" on sd_reimbursements for select using (sd_can_see_account(account_id));
