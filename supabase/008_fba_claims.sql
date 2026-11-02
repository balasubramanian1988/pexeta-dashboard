-- ============================================================
--  Pexeta Seller Dashboard — Amazon FBA warehouse claims
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

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
