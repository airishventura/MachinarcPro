-- MachinArc Pro · Row Level Security (Supabase deployment step; idempotent)
-- Apply after drizzle migrations:  psql "$DATABASE_URL" -f supabase/rls.sql
-- The app server connects with a privileged role (bypasses RLS) and enforces workspace scoping in code;
-- these policies are defense in depth for any client-side / PostgREST access via auth.uid().
-- Verified by tests/rls.test.ts (runs inside a rolled-back transaction with a stub auth.uid()).

create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    execute $f$ create function auth.uid() returns uuid language sql stable as $b$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $b$ $f$;
  end if;
end $$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;
create or replace function public.machine_ws(m uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from machines where id = m $$;
create or replace function public.arc_ws(a uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from arcs where id = a $$;
create or replace function public.run_ws(r uuid) returns uuid language sql stable security definer set search_path = public as $$ select m.workspace_id from machine_runs mr join machines m on m.id = mr.machine_id where mr.id = r $$;
create or replace function public.arc_run_ws(r uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from arc_runs where id = r $$;

do $$
declare t text;
begin
  -- Tables with a direct workspace_id column
  foreach t in array array['machines','machine_tasks','activities','usage_records','transactions','arcs','arc_runs','arc_approvals',
    'tool_executions','approval_requests','workspace_integrations','machine_call_relationships','jobs','schedules','webhooks','event_triggers','trigger_fires'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ws_member on %I', t);
    execute format('create policy ws_member on %I for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
  -- Child tables scoped through their parent
  foreach t in array array['machine_tools','machine_permissions','machine_memories','machine_runs','machine_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ws_member on %I', t);
    execute format('create policy ws_member on %I for all using (public.is_member(public.machine_ws(machine_id)))', t);
  end loop;
  foreach t in array array['arc_nodes','arc_edges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ws_member on %I', t);
    execute format('create policy ws_member on %I for all using (public.is_member(public.arc_ws(arc_id)))', t);
  end loop;
  foreach t in array array['arc_run_nodes','arc_run_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ws_member on %I', t);
    execute format('create policy ws_member on %I for select using (public.is_member(public.arc_run_ws(arc_run_id)))', t);
  end loop;
  foreach t in array array['run_sources','run_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ws_member on %I', t);
    execute format('create policy ws_member on %I for select using (public.is_member(public.run_ws(machine_run_id)))', t);
  end loop;
end $$;

-- Workspaces + membership
alter table workspaces enable row level security;
drop policy if exists ws_member on workspaces;
create policy ws_member on workspaces for select using (public.is_member(id));
alter table workspace_members enable row level security;
drop policy if exists wm_self on workspace_members;
create policy wm_self on workspace_members for select using (user_id = auth.uid());
alter table profiles enable row level security;
drop policy if exists profile_self on profiles;
create policy profile_self on profiles for select using (id = auth.uid());

-- Never client-readable: credentials, sessions, worker internals (RLS on, no policies = deny all).
alter table integration_credentials enable row level security;
alter table sessions enable row level security;
alter table worker_heartbeats enable row level security;
