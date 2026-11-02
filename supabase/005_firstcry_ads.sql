-- ============================================================
--  Pexeta Seller Dashboard — FirstCry Ads
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  The same statements are in schema.sql for new installs.
-- ============================================================

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
