-- Row-level security test: two sellers and one team member. Run after supabase_stub.sql, the ops schema and schema.sql.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
insert into clients (name) values ('Other Brand') on conflict do nothing;
insert into sd_accounts (client_id, marketplace_id, name)
  select c.id, m.id, 'Other Brand — Amazon.in' from clients c, marketplaces m where c.name='Other Brand' and m.name='Amazon'
  and not exists (select 1 from sd_accounts a where a.client_id=c.id);
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@rootandsoil.test'),('22222222-2222-2222-2222-222222222222','owner@other.test') on conflict do nothing;
insert into sd_client_users (user_id, client_id, email) select '11111111-1111-1111-1111-111111111111', id, 'owner@rootandsoil.test' from clients where name='Root and Soil' on conflict do nothing;
insert into sd_client_users (user_id, client_id, email) select '22222222-2222-2222-2222-222222222222', id, 'owner@other.test' from clients where name='Other Brand' on conflict do nothing;
insert into sd_orders (account_id, order_item_key, amazon_order_id, purchase_at, purchase_date, quantity)
  select id, 'rs-1', 'RS-ORDER', now(), current_date, 1 from sd_accounts where name like 'Root and Soil%' on conflict do nothing;
insert into sd_orders (account_id, order_item_key, amazon_order_id, purchase_at, purchase_date, quantity)
  select id, 'ob-1', 'OTHER-ORDER', now(), current_date, 1 from sd_accounts where name like 'Other Brand%' on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false), set_config('request.jwt.claims','{"email":"owner@rootandsoil.test"}',false) \gset
select 'Root and Soil seller sees orders:' as who, string_agg(amazon_order_id, ', ') from sd_orders;
select 'Root and Soil seller sees accounts:' as who, string_agg(name, ', ') from sd_accounts;
select 'Root and Soil seller sees client names:' as who, string_agg(name, ', ') from clients;
select 'Root and Soil seller sees team members:' as who, count(*) from team_members;

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false), set_config('request.jwt.claims','{"email":"owner@other.test"}',false) \gset
select 'Other Brand seller sees orders:' as who, string_agg(amazon_order_id, ', ') from sd_orders;

select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{"email":"ananth@pexeta.in","app_metadata":{"providers":["google"]}}',false) \gset
select 'Team member (VP) sees orders:' as who, string_agg(amazon_order_id, ', ' order by amazon_order_id) from sd_orders;

select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{"email":"ananth@pexeta.in","app_metadata":{"providers":["email"]}}',false) \gset
select 'Password account using a team email sees orders:' as who, count(*) from sd_orders;

select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{"email":"stranger@gmail.com"}',false) \gset
select 'Signed-in stranger sees orders:' as who, count(*) from sd_orders;
reset role;
