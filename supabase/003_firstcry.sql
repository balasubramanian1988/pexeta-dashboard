-- ============================================================
--  Pexeta Seller Dashboard — FirstCry (marketplace / dropship)
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

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
