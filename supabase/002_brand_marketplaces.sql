-- ============================================================
--  Pexeta Seller Dashboard — one account per brand per marketplace
--  Lets the team opt a brand into chosen marketplaces and add more later
--  (Brands page). Run once in Supabase: SQL Editor → New query → paste → Run.
-- ============================================================
create unique index if not exists sd_accounts_client_marketplace on sd_accounts (client_id, marketplace_id);
