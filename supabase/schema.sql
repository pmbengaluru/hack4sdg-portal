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
  college       text,
  created_at    timestamptz not null default now()
);
alter table public.teams add column if not exists college text;
alter table public.teams add column if not exists table_no text;  -- table / team number shown to judges
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
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.checkpoints add column if not exists starts_at timestamptz;
alter table public.checkpoints add column if not exists ends_at   timestamptz;
-- scan checkpoints only: volunteers are asked for the team's table number when it has none (e.g. at check-in)
alter table public.checkpoints add column if not exists ask_table boolean not null default false;
-- self check-in: participants scan a QR shown on a screen and type their own name + team
alter table public.checkpoints add column if not exists self_checkin boolean not null default false;
alter table public.checkpoints add column if not exists self_secret text not null default md5(random()::text || clock_timestamp()::text);

create table if not exists public.self_checkins (
  id             bigint generated always as identity primary key,
  checkpoint_id  bigint not null references public.checkpoints(id) on delete cascade,
  team_text      text not null,
  name_text      text not null,
  team_id        bigint references public.teams(id) on delete set null,
  participant_id bigint references public.participants(id) on delete set null,
  status         text not null check (status in ('matched','already','unmatched','resolved','dismissed')),
  device_id      text,
  created_at     timestamptz not null default now()
);
create index if not exists self_checkins_cp_idx on public.self_checkins (checkpoint_id, status);

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

-- which mentor judges which team, per judging round (only enforced when settings.assign_mentors = 'on')
create table if not exists public.judge_assignments (
  id            bigint generated always as identity primary key,
  checkpoint_id bigint not null references public.checkpoints(id) on delete cascade,
  team_id       bigint not null references public.teams(id) on delete cascade,
  judge_email   text not null references public.staff(email) on delete cascade on update cascade,
  created_at    timestamptz not null default now(),
  unique (checkpoint_id, team_id, judge_email)
);
create index if not exists judge_assignments_judge_idx on public.judge_assignments (judge_email, checkpoint_id);

create table if not exists public.settings (
  key   text primary key,
  value text
);
insert into public.settings (key, value) values
  ('event_name', 'HACK4SDG'),
  ('assign_mentors', 'off'),
  ('email_subject', 'Your {{event}} entry pass – {{name}}'),
  ('email_message', 'Hi {{name}},

Your team "{{team}}" is registered for {{event}}.
The entry QR codes are below – they will be scanned at check-in and at other checkpoints during the event, so every member should keep their own QR handy on their phone.

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

create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

-- Can the signed-in user score this team in this round?
-- Admins always; mentors always when assignments are off, otherwise only their assigned teams.
create or replace function public.can_judge(p_checkpoint bigint, p_team bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.has_role('admin') then true
    when not public.has_role('mentor') then false
    when coalesce((select value from public.settings where key = 'assign_mentors'), 'off') <> 'on' then true
    else exists (select 1 from public.judge_assignments a
                 where a.checkpoint_id = p_checkpoint and a.team_id = p_team and a.judge_email = public.my_email())
  end
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
alter table public.judge_assignments enable row level security;
alter table public.self_checkins enable row level security;

do $$
declare t text;
begin
  -- drop old policies so the file can be re-run
  for t in select unnest(array['staff','teams','participants','checkpoints','scans','scores','settings','judge_assignments','self_checkins']) loop
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
  with check (judge_id = auth.uid() and public.can_judge(checkpoint_id, team_id)
              and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.type = 'judging' and c.active));
create policy scores_update on public.scores for update to authenticated
  using (judge_id = auth.uid() and public.can_judge(checkpoint_id, team_id))
  with check (judge_id = auth.uid() and public.can_judge(checkpoint_id, team_id)
              and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.type = 'judging' and c.active));

-- judge assignments: staff can see them (mentors need their list), admins manage
create policy assign_read  on public.judge_assignments for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy assign_admin on public.judge_assignments for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- self check-ins: written only by self_checkin(); staff can read; admins/volunteers resolve
create policy selfci_read  on public.self_checkins for select to authenticated using (public.has_role('admin','volunteer','mentor'));
create policy selfci_write on public.self_checkins for update to authenticated using (public.has_role('admin','volunteer')) with check (public.has_role('admin','volunteer'));
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
      'team', jsonb_build_object('id',t.id,'name',t.name,'table_no',t.table_no),
      'ask_table', cp.ask_table and t.table_no is null,
      'scanned_at', existing.scanned_at, 'scanned_by', existing.scanner_name);
  end if;

  insert into public.scans (checkpoint_id, participant_id, scanned_by, scanner_name)
  values (cp.id, p.id, auth.uid(), me_name);

  return jsonb_build_object('status','ok',
    'participant', jsonb_build_object('id',p.id,'name',p.name,'email',p.email),
    'team', jsonb_build_object('id',t.id,'name',t.name,'table_no',t.table_no),
    'ask_table', cp.ask_table and t.table_no is null,
    'team_checked', (select count(*) from public.scans s join public.participants q on q.id = s.participant_id
                     where s.checkpoint_id = cp.id and q.team_id = t.id),
    'team_size', (select count(*) from public.participants where team_id = t.id));
end $$;

-- ---------------------------------------------------------------
-- RPC: import teams from parsed CSV (one transaction)
-- p_data = [{"name":"Team A","size":4,"college":"..","members":[{"name":"..","email":"..","phone":"..","leader":true}]}]
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
      insert into public.teams (name, declared_size, college)
      values (trim(tj->>'name'), nullif(tj->>'size','')::int, nullif(trim(tj->>'college'),''))
      returning id into v_team_id;
      teams_new := teams_new + 1;
    else
      update public.teams set declared_size = coalesce(nullif(tj->>'size','')::int, declared_size),
                              college = coalesce(nullif(trim(tj->>'college'),''), college)
       where id = v_team_id;
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

-- ---------------------------------------------------------------
-- RPC: volunteers/admins set a team's table number (e.g. while checking the team in)
-- returns {status:'ok'} or {status:'taken', team:<other team>} unless p_force
-- ---------------------------------------------------------------
create or replace function public.set_table_no(p_team bigint, p_table text, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(trim(coalesce(p_table, '')), '');
  other text;
begin
  if not public.has_role('admin','volunteer') then
    return jsonb_build_object('status','forbidden','message','Only volunteers and admins can set table numbers.');
  end if;
  if length(v) > 20 then
    return jsonb_build_object('status','error','message','Table number is too long.');
  end if;
  if v is not null and not p_force then
    select name into other from public.teams where lower(table_no) = lower(v) and id <> p_team limit 1;
    if other is not null then
      return jsonb_build_object('status','taken','team',other);
    end if;
  end if;
  update public.teams set table_no = v where id = p_team;
  if not found then return jsonb_build_object('status','error','message','Team not found.'); end if;
  return jsonb_build_object('status','ok','table_no',v);
end $$;

-- ---------------------------------------------------------------
-- Self check-in (public, no login). The display screen shows a QR whose code changes every
-- 30 s: code = first 10 hex chars of sha256(self_secret || ':' || 30-second window). Codes stay
-- valid for ~3 minutes so people have time to fill in the form.
-- ---------------------------------------------------------------
create or replace function public.norm_text(t text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]', '', 'g') $$;

create or replace function public.self_code_ok(cp public.checkpoints, p_code text) returns boolean
language sql stable as $$
  select exists (
    select 1 from generate_series(0, 6) g
    where left(encode(sha256(convert_to(cp.self_secret || ':' || (floor(extract(epoch from now()) / 30)::bigint - g)::text, 'UTF8')), 'hex'), 10)
          = lower(coalesce(p_code, ''))
  )
$$;

create or replace function public.self_checkin_info(p_checkpoint bigint, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cp public.checkpoints;
begin
  select * into cp from public.checkpoints where id = p_checkpoint;
  if cp.id is null or cp.type <> 'scan' or not cp.self_checkin or not cp.active then
    return jsonb_build_object('status','closed');
  end if;
  if not public.self_code_ok(cp, p_code) then return jsonb_build_object('status','expired'); end if;
  return jsonb_build_object('status','ok', 'checkpoint', cp.name,
    'event', (select value from public.settings where key = 'event_name'),
    'teams', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from public.teams));
end $$;

create or replace function public.self_checkin(p_checkpoint bigint, p_code text, p_team text, p_name text, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cp public.checkpoints;
  v_team public.teams;
  v_p public.participants;
  n_team text := public.norm_text(p_team);
  n_name text := public.norm_text(p_name);
  first_tok text := public.norm_text(split_part(trim(coalesce(p_name, '')), ' ', 1));
  cand bigint[];
  cnt int;
  existing public.scans;
begin
  select * into cp from public.checkpoints where id = p_checkpoint;
  if cp.id is null or cp.type <> 'scan' or not cp.self_checkin or not cp.active then
    return jsonb_build_object('status','closed');
  end if;
  if not public.self_code_ok(cp, p_code) then return jsonb_build_object('status','expired'); end if;
  if length(n_team) < 1 or length(n_name) < 2 or length(p_team) > 120 or length(p_name) > 120 then
    return jsonb_build_object('status','invalid','message','Please enter your full name and team name.');
  end if;

  -- candidate teams: same name ignoring case/spaces/punctuation (there can be several, e.g. "Brain Wave" and
  -- "BrainWave"), else up to 3 teams whose name contains / is contained in the typed text
  select array_agg(id) into cand from public.teams where public.norm_text(name) = n_team;
  if cand is null and length(n_team) >= 4 then
    select array_agg(id) into cand from public.teams
     where public.norm_text(name) like '%' || n_team || '%' or n_team like '%' || public.norm_text(name) || '%';
    if coalesce(array_length(cand, 1), 0) > 3 then cand := null; end if;
  end if;

  -- the person, across those teams: exact name, else a unique first name, else a unique partial match
  if cand is not null then
    select count(*) into cnt from public.participants where team_id = any(cand) and public.norm_text(name) = n_name;
    if cnt = 1 then
      select * into v_p from public.participants where team_id = any(cand) and public.norm_text(name) = n_name;
    end if;
    if v_p.id is null and length(first_tok) >= 2 then
      select count(*) into cnt from public.participants
       where team_id = any(cand) and public.norm_text(split_part(trim(name), ' ', 1)) = first_tok;
      if cnt = 1 then
        select * into v_p from public.participants
         where team_id = any(cand) and public.norm_text(split_part(trim(name), ' ', 1)) = first_tok;
      end if;
    end if;
    if v_p.id is null and length(n_name) >= 3 then
      select count(*) into cnt from public.participants
       where team_id = any(cand) and (public.norm_text(name) like '%' || n_name || '%' or n_name like '%' || public.norm_text(name) || '%');
      if cnt = 1 then
        select * into v_p from public.participants
         where team_id = any(cand) and (public.norm_text(name) like '%' || n_name || '%' or n_name like '%' || public.norm_text(name) || '%');
      end if;
    end if;
  end if;
  if v_p.id is not null then
    select * into v_team from public.teams where id = v_p.team_id;
  elsif array_length(cand, 1) = 1 then
    select * into v_team from public.teams where id = cand[1];
  end if;

  if v_p.id is null then
    insert into public.self_checkins (checkpoint_id, team_text, name_text, team_id, status, device_id)
    values (cp.id, trim(p_team), trim(p_name), v_team.id, 'unmatched', left(p_device, 64));
    return jsonb_build_object('status','pending', 'team_found', cand is not null);
  end if;

  select * into existing from public.scans where checkpoint_id = cp.id and participant_id = v_p.id;
  if existing.id is not null then
    insert into public.self_checkins (checkpoint_id, team_text, name_text, team_id, participant_id, status, device_id)
    values (cp.id, trim(p_team), trim(p_name), v_team.id, v_p.id, 'already', left(p_device, 64));
    return jsonb_build_object('status','already', 'name', v_p.name, 'team', v_team.name, 'table_no', v_team.table_no, 'at', existing.scanned_at);
  end if;

  insert into public.scans (checkpoint_id, participant_id, scanner_name) values (cp.id, v_p.id, 'Self check-in');
  insert into public.self_checkins (checkpoint_id, team_text, name_text, team_id, participant_id, status, device_id)
  values (cp.id, trim(p_team), trim(p_name), v_team.id, v_p.id, 'matched', left(p_device, 64));
  return jsonb_build_object('status','ok', 'name', v_p.name, 'team', v_team.name, 'table_no', v_team.table_no);
end $$;

-- staff resolve an unmatched self check-in by picking the right participant
create or replace function public.resolve_self_checkin(p_id bigint, p_participant bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sc public.self_checkins; v_name text;
begin
  if not public.has_role('admin','volunteer') then return jsonb_build_object('status','forbidden'); end if;
  select * into sc from public.self_checkins where id = p_id;
  if sc.id is null then return jsonb_build_object('status','error','message','Not found'); end if;
  insert into public.scans (checkpoint_id, participant_id, scanned_by, scanner_name)
  values (sc.checkpoint_id, p_participant, auth.uid(), 'Self check-in (confirmed)')
  on conflict (checkpoint_id, participant_id) do nothing;
  update public.self_checkins set status = 'resolved', participant_id = p_participant,
    team_id = (select team_id from public.participants where id = p_participant) where id = p_id;
  select name into v_name from public.participants where id = p_participant;
  return jsonb_build_object('status','ok','name',v_name);
end $$;

revoke execute on function public.self_checkin_info(bigint, text) from public;
revoke execute on function public.self_checkin(bigint, text, text, text, text) from public;
grant  execute on function public.self_checkin_info(bigint, text) to anon, authenticated;
grant  execute on function public.self_checkin(bigint, text, text, text, text) to anon, authenticated;
revoke execute on function public.resolve_self_checkin(bigint, bigint) from anon, public;
grant  execute on function public.resolve_self_checkin(bigint, bigint) to authenticated;
revoke execute on function public.self_code_ok(public.checkpoints, text) from anon, public;
revoke execute on function public.set_table_no(bigint, text, boolean) from anon, public;
grant  execute on function public.set_table_no(bigint, text, boolean) to authenticated;
revoke execute on function public.scan_participant(bigint, text) from anon, public;
revoke execute on function public.import_teams(jsonb, boolean)   from anon, public;
grant  execute on function public.scan_participant(bigint, text) to authenticated;
grant  execute on function public.import_teams(jsonb, boolean)   to authenticated;
revoke execute on function public.my_role()          from anon, public;
revoke execute on function public.my_email()         from anon, public;
revoke execute on function public.can_judge(bigint, bigint) from anon, public;
grant  execute on function public.can_judge(bigint, bigint) to authenticated;
revoke execute on function public.has_role(text[])   from anon, public;
grant  execute on function public.my_role() to authenticated;
grant  execute on function public.has_role(text[]) to authenticated;

-- ---------------------------------------------------------------
-- FIRST ADMIN: replace with your details, then create the same email
-- in Authentication -> Users -> "Add user" (tick auto-confirm).
-- ---------------------------------------------------------------
-- insert into public.staff (email, name, role) values ('pm.bengaluru@aiesecmember.in', 'Admin', 'admin')
-- on conflict (email) do update set role = 'admin';
