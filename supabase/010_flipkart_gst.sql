-- ============================================================
--  Pexeta Seller Dashboard — Flipkart GST tab
--  Adds GST registration, B2B, HSN and IGST / CGST / SGST columns to the Flipkart Sales report table.
--  Run once in Supabase after 009_flipkart.sql: SQL Editor → New query → paste → Run. Safe to run again.
--  (New installs: schema.sql and 009_flipkart.sql already include these columns.)
--  Sales reports uploaded before this was run need uploading again to fill the new columns.
-- ============================================================
alter table sd_fk_sales add column if not exists igst numeric not null default 0;
alter table sd_fk_sales add column if not exists cgst numeric not null default 0;
alter table sd_fk_sales add column if not exists sgst numeric not null default 0;
alter table sd_fk_sales add column if not exists seller_gstin text not null default '';
alter table sd_fk_sales add column if not exists buyer_gstin text not null default '';
alter table sd_fk_sales add column if not exists hsn text not null default '';
alter table sd_fk_sales add column if not exists shipped_from text not null default '';
create index if not exists sd_fk_sales_invoice on sd_fk_sales (account_id, invoice_date);
