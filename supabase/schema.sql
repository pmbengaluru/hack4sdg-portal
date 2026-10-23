-- HACK4SDG event manager schema
-- Run once in Supabase Dashboard -> SQL Editor (safe to re-run).

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  name       text not null,
  role       text not null check (role in ('admin','volunteer','mentor')),
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id            bigint generated always as identity primary key,
  name          text not null,
  declared_size int,
  created_at    timestamptz not null default now()
);
create unique index if not exists teams_name_key on public.teams (lower(name));

create table if not exists public.participants (
  id            bigint generated always as identity primary key,
  team_id       bigint not null references public.teams(id) on delete cascade,
  name          text not null,
  email         text check (email = lower(email)),
  phone         text,
  is_leader     boolean not null default false,
  token         text not null unique default upper(replace(substr(gen_random_uuid()::text, 1, 13), '-', '')),
  email_status  text not null default 'pending' check (email_status in ('pending','sent','failed')),
  email_sent_at timestamptz,
  email_error   text,
  created_at    timestamptz not null default now()
);
create unique index if not exists participants_email_key on public.participants (email) where email is not null;
create index if not exists participants_team_idx on public.participants (team_id);

create table if not exists public.checkpoints (
  id          bigint generated always as identity primary key,
  name        text not null,
  type        text not null check (type in ('scan','judging')),
  description text,
  -- judging only: [{"name":"Innovation","max":10}, ...]
  criteria    jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.scans (
  id             bigint generated always as identity primary key,
  checkpoint_id  bigint not null references public.checkpoints(id) on delete cascade,
  participant_id bigint not null references public.participants(id) on delete cascade,
  scanned_by     uuid references auth.users(id) on delete set null,
  scanner_name   text,
  scanned_at     timestamptz not null default now(),
  unique (checkpoint_id, participant_id)
);
create index if not exists scans_participant_idx on public.scans (participant_id);

create table if not exists public.scores (
  id            bigint generated always as identity primary key,
  checkpoint_id bigint not null references public.checkpoints(id) on delete cascade,
  team_id       bigint not null references public.teams(id) on delete cascade,
  judge_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  judge_name    text,
  scores        jsonb not null default '{}'::jsonb,
  total         numeric not null default 0,
  comments      text,
  updated_at    timestamptz not null default now(),
  unique (checkpoint_id, team_id, judge_id)
);
create index if not exists scores_team_idx on public.scores (team_id);

create table if not exists public.settings (
  key   text primary key,
  value text
);
insert into public.settings (key, value) values
  ('event_name', 'HACK4SDG'),
  ('email_subject', 'Your {{event}} entry pass – {{name}}'),
  ('email_message', 'Hi {{name}},

You are registered for {{event}} as part of team "{{team}}".
Please keep the QR code below handy – it will be scanned at check-in and other checkpoints during the event.

See you there!')
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select s.role from public.staff s
  join auth.users u on lower(u.email) = s.email
  where u.id = auth.uid()
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = any(roles), false)
$$;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.staff        enable row level security;
alter table public.teams        enable row level security;
alter table public.participants enable row level security;
alter table public.checkpoints  enable row level security;
alter table public.scans        enable row level security;
alter table public.scores       enable row level security;
alter table public.settings     enable row level security;

do $$
declare t text;
begin
  -- drop old policies so the file can be re-run
  for t in select unnest(array['staff','teams','participants','checkpoints','scans','scores','settings']) loop
    execute (select coalesce(string_agg(format('drop policy if exists %I on public.%I;', policyname, t), ' '), '')
             from pg_policies where schemaname = 'public' and tablename = t);
  end loop;
end $$;

-- staff: everyone on staff can see the staff list, admins manage it
create policy staff_read  on public.staff for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy staff_admin on public.staff for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- teams / participants / checkpoints / settings: staff read, admin write
create policy teams_read   on public.teams        for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy teams_admin  on public.teams        for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy parts_read   on public.participants for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy parts_admin  on public.participants for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy cps_read     on public.checkpoints  for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy cps_admin    on public.checkpoints  for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy settings_read  on public.settings   for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy settings_admin on public.settings   for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- scans: staff can read; inserts go through scan_participant(); admins can undo
create policy scans_read   on public.scans for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy scans_delete on public.scans for delete to authenticated using (public.has_role('admin'));

-- scores: judges see/edit only their own, admins see everything
create policy scores_read  on public.scores for select to authenticated
  using (public.has_role('admin') or (public.has_role('mentor') and judge_id = auth.uid()));
create policy scores_insert on public.scores for insert to authenticated
  with check (public.has_role('admin','mentor') and judge_id = auth.uid()
              and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.type = 'judging' and c.active));
create policy scores_update on public.scores for update to authenticated
  using (judge_id = auth.uid() and public.has_role('admin','mentor'))
  with check (judge_id = auth.uid()
              and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.type = 'judging' and c.active));
create policy scores_delete on public.scores for delete to authenticated using (public.has_role('admin'));

-- ---------------------------------------------------------------
-- RPC: scan a participant QR at a checkpoint
-- ---------------------------------------------------------------
create or replace function public.scan_participant(p_checkpoint bigint, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cp public.checkpoints;
  p  public.participants;
  t  public.teams;
  existing public.scans;
  me_name text;
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.has_role('admin','volunteer') then
    return jsonb_build_object('status','forbidden','message','Only volunteers and admins can scan.');
  end if;
  select * into cp from public.checkpoints where id = p_checkpoint;
  if cp.id is null or cp.type <> 'scan' then
    return jsonb_build_object('status','error','message','Not a scanning checkpoint.');
  end if;
  if not cp.active then
    return jsonb_build_object('status','error','message','This checkpoint is closed.');
  end if;
  select * into p from public.participants where token = code;
  if p.id is null then
    return jsonb_build_object('status','not_found','message','QR code not recognised.');
  end if;
  select * into t from public.teams where id = p.team_id;
  select s.name into me_name from public.staff s join auth.users u on lower(u.email) = s.email where u.id = auth.uid();

  select * into existing from public.scans where checkpoint_id = cp.id and participant_id = p.id;
  if existing.id is not null then
    return jsonb_build_object('status','duplicate',
      'participant', jsonb_build_object('id',p.id,'name',p.name,'email',p.email),
      'team', jsonb_build_object('id',t.id,'name',t.name),
      'scanned_at', existing.scanned_at, 'scanned_by', existing.scanner_name);
  end if;

  insert into public.scans (checkpoint_id, participant_id, scanned_by, scanner_name)
  values (cp.id, p.id, auth.uid(), me_name);

  return jsonb_build_object('status','ok',
    'participant', jsonb_build_object('id',p.id,'name',p.name,'email',p.email),
    'team', jsonb_build_object('id',t.id,'name',t.name),
    'team_checked', (select count(*) from public.scans s join public.participants q on q.id = s.participant_id
                     where s.checkpoint_id = cp.id and q.team_id = t.id),
    'team_size', (select count(*) from public.participants where team_id = t.id));
end $$;

-- ---------------------------------------------------------------
-- RPC: import teams from parsed CSV (one transaction)
-- p_data = [{"name":"Team A","size":4,"members":[{"name":"..","email":"..","phone":"..","leader":true}]}]
-- ---------------------------------------------------------------
create or replace function public.import_teams(p_data jsonb, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tj jsonb; mj jsonb;
  v_team_id bigint; v_pid bigint;
  v_email text;
  teams_new int := 0; teams_upd int := 0; mem_new int := 0; mem_upd int := 0;
begin
  if not public.has_role('admin') then raise exception 'Only admins can import'; end if;
  if p_replace then
    delete from public.teams;  -- cascades to participants, scans, scores
  end if;

  for tj in select * from jsonb_array_elements(p_data) loop
    select id into v_team_id from public.teams where lower(name) = lower(trim(tj->>'name'));
    if v_team_id is null then
      insert into public.teams (name, declared_size) values (trim(tj->>'name'), nullif(tj->>'size','')::int)
      returning id into v_team_id;
      teams_new := teams_new + 1;
    else
      update public.teams set declared_size = coalesce(nullif(tj->>'size','')::int, declared_size) where id = v_team_id;
      teams_upd := teams_upd + 1;
    end if;

    for mj in select * from jsonb_array_elements(tj->'members') loop
      v_email := nullif(lower(trim(mj->>'email')), '');
      v_pid := null;
      if v_email is not null then
        select id into v_pid from public.participants where email = v_email;
      else
        select id into v_pid from public.participants where team_id = v_team_id and lower(name) = lower(trim(mj->>'name'));
      end if;
      if v_pid is null then
        insert into public.participants (team_id, name, email, phone, is_leader)
        values (v_team_id, trim(mj->>'name'), v_email, nullif(trim(mj->>'phone'),''), coalesce((mj->>'leader')::boolean, false));
        mem_new := mem_new + 1;
      else
        update public.participants
           set team_id = v_team_id, name = trim(mj->>'name'),
               phone = coalesce(nullif(trim(mj->>'phone'),''), phone),
               is_leader = coalesce((mj->>'leader')::boolean, false)
         where id = v_pid;
        mem_upd := mem_upd + 1;
      end if;
    end loop;
  end loop;

  -- drop teams left empty by members moving to another team
  delete from public.teams t where not exists (select 1 from public.participants p where p.team_id = t.id);

  return jsonb_build_object('teams_created', teams_new, 'teams_updated', teams_upd,
                            'members_created', mem_new, 'members_updated', mem_upd);
end $$;

revoke execute on function public.scan_participant(bigint, text) from anon, public;
revoke execute on function public.import_teams(jsonb, boolean)   from anon, public;
grant  execute on function public.scan_participant(bigint, text) to authenticated;
grant  execute on function public.import_teams(jsonb, boolean)   to authenticated;
grant  execute on function public.my_role() to authenticated;
grant  execute on function public.has_role(text[]) to authenticated;

-- ---------------------------------------------------------------
-- FIRST ADMIN: replace with your details, then create the same email
-- in Authentication -> Users -> "Add user" (tick auto-confirm).
-- ---------------------------------------------------------------
-- insert into public.staff (email, name, role) values ('pm.bengaluru@aiesecmember.in', 'Admin', 'admin')
-- on conflict (email) do update set role = 'admin';
