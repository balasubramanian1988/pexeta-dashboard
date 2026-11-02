-- ============================================================
--  Pexeta Seller Dashboard — Amazon Brand Analytics
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

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
