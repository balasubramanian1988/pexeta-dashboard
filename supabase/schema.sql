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
