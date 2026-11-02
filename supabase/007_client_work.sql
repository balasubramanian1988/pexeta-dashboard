-- ============================================================
--  Pexeta Seller Dashboard — Pexeta's work, from Pexeta Ops
--  Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--  Same file in pexeta-ops as supabase/005_client_view.sql. Ops and the dashboard share this database.
-- ============================================================

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
