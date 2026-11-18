create schema match_stats;
revoke all on schema match_stats from public, anon, authenticated;

create table match_stats.config (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz,
  npc_enabled boolean not null default false
);
insert into match_stats.config default values;

create table match_stats.totals (
  category text primary key check (category in ('npc_easy','npc_standard','npc_strong','npc_strongest','online')),
  finished bigint not null default 0 check (finished >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  check (case when category = 'online' then wins = 0 and losses = 0 and draws <= finished
    else finished = wins + losses + draws end)
) with (fillfactor = 75);
insert into match_stats.totals(category)
select unnest(array['npc_easy','npc_standard','npc_strong','npc_strongest','online']);

create table match_stats.npc_receipt (
  id uuid primary key,
  fingerprint bytea not null,
  expires_at timestamptz not null
);
create index npc_receipt_expiry on match_stats.npc_receipt(expires_at);
create table match_stats.rate (
  subject uuid not null,
  kind smallint not null,
  bucket timestamptz not null,
  hits integer not null,
  primary key (subject, kind, bucket)
);

alter table match_stats.config enable row level security;
alter table match_stats.totals enable row level security;
alter table match_stats.npc_receipt enable row level security;
alter table match_stats.rate enable row level security;
revoke all on all tables in schema match_stats from public, anon, authenticated;

create function public.read_match_statistics() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'startedAt', c.started_at,
    'rows', (select jsonb_agg(jsonb_build_object('category', t.category, 'finished', t.finished,
      'wins', t.wins, 'losses', t.losses, 'draws', t.draws) order by t.category) from match_stats.totals t)
  )
  from match_stats.config c where c.singleton and c.started_at is not null
$$;

create function public.report_npc_match(p_uid uuid, p_id uuid, p_category text, p_result text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  config match_stats.config;
  stamp timestamptz;
  checked_at timestamptz := now();
  mark bytea;
  previous bytea;
  total integer;
  slot integer;
  scope uuid;
  bucket_at timestamptz;
  ceiling integer;
begin
  if p_uid is null or p_id is null or p_category is null or p_result is null
    or p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_category not in ('npc_easy','npc_standard','npc_strong','npc_strongest')
    or p_result not in ('win','loss','draw') then return 'invalid'; end if;
  select * into config from match_stats.config where singleton;
  if config.started_at is null or not config.npc_enabled then return 'disabled'; end if;
  select to_timestamp(sum(get_byte(uuid_send(p_id), i)::bigint << (8*(5-i)))::double precision / 1000)
    into stamp from generate_series(0,5) as i;
  if stamp < config.started_at or stamp < checked_at - interval '72 hours'
     or stamp > checked_at + interval '5 minutes' then return 'invalid'; end if;

  mark := sha256(uuid_send(p_uid) || convert_to(p_category || ':' || p_result, 'UTF8'));
  select fingerprint into previous from match_stats.npc_receipt where id = p_id;
  if found then return case when previous = mark then 'duplicate' else 'conflict' end; end if;

  -- Per-guest short and daily limits, plus a budget shared by all NPC reporters.
  for slot in 1..3 loop
    scope := case when slot = 3 then '00000000-0000-0000-0000-000000000000'::uuid else p_uid end;
    bucket_at := case when slot = 1 then date_bin(interval '10 minutes', checked_at, '2000-01-01 UTC'::timestamptz)
      else date_trunc('day', checked_at, 'UTC') end;
    ceiling := case slot when 1 then 6 when 2 then 30 else 10000 end;
    insert into match_stats.rate as r(subject,kind,bucket,hits) values (scope,slot,bucket_at,1)
      on conflict (subject,kind,bucket) do update set hits = r.hits + 1 where r.hits < ceiling
      returning hits into total;
    if not found then return 'limited'; end if;
  end loop;

  insert into match_stats.npc_receipt values (p_id,mark,stamp + interval '72 hours 10 minutes')
    on conflict (id) do nothing;
  if not found then
    select fingerprint into previous from match_stats.npc_receipt where id = p_id;
    return case when previous = mark then 'duplicate' else 'conflict' end;
  end if;
  update match_stats.totals set finished = finished + 1,
    wins = wins + (p_result = 'win')::integer, losses = losses + (p_result = 'loss')::integer,
    draws = draws + (p_result = 'draw')::integer where category = p_category;
  if not found then raise exception 'NPC aggregate is missing'; end if;
  return 'accepted';
end
$$;

alter table public.online_rooms add column stats_finished_at timestamptz,
  add column stats_draw boolean, add column stats_counted_at timestamptz;
create index online_uncounted_statistics on public.online_rooms(stats_finished_at,id)
  where stats_finished_at is not null and stats_counted_at is null;

create function match_stats.mark_online() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.state->>'phase' = 'playing' and new.state->>'phase' = 'finished'
    and new.revision = old.revision + 1 and new.state->'departure' = 'null'::jsonb
    and jsonb_typeof(new.state->'_statsDraw') = 'boolean' then
    new.stats_finished_at := now();
    new.stats_draw := (new.state->>'_statsDraw')::boolean;
  end if;
  -- The transient trusted Edge result must never become a part of the saved replay.
  new.state := new.state - '_statsDraw';
  return new;
end
$$;
create trigger online_statistics_marker before update of state on public.online_rooms
  for each row when (new.state ? '_statsDraw') execute function match_stats.mark_online();

create function match_stats.collect_online() returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '500ms' as $$
declare
  activated timestamptz;
  collected integer;
  finished_count integer;
  draw_count integer;
begin
  select started_at into activated from match_stats.config where singleton;
  if activated is null then return 0; end if;
  with batch as (
    select id from public.online_rooms where stats_finished_at is not null and stats_counted_at is null
    order by stats_finished_at,id limit 200 for update skip locked
  ), marked as (
    update public.online_rooms r set stats_counted_at = now()
    from batch where r.id = batch.id returning r.stats_finished_at,r.stats_draw
  )
  select count(*), count(*) filter (where stats_finished_at >= activated),
    count(*) filter (where stats_finished_at >= activated and stats_draw)
    into collected, finished_count, draw_count from marked;
  if finished_count > 0 then
    update match_stats.totals set finished = finished + finished_count, draws = draws + draw_count
      where category = 'online';
    if not found then raise exception 'Online aggregate is missing'; end if;
  end if;
  return collected;
end
$$;

create or replace function public.online_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.online_rooms r where not public.online_is_live(r)
    and (r.stats_finished_at is null or r.stats_counted_at is not null);
  delete from public.online_rate where minute < now() - interval '1 hour';
end
$$;
create function match_stats.cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from match_stats.npc_receipt where expires_at < now();
  delete from match_stats.rate where bucket < now() - interval '2 days'
$$;

revoke execute on all functions in schema match_stats from public, anon, authenticated;
revoke execute on function public.read_match_statistics(), public.report_npc_match(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.read_match_statistics() to anon, authenticated;
grant execute on function public.report_npc_match(uuid,uuid,text,text) to service_role;

select cron.schedule('jinrocard-match-stats-collect','*/5 * * * *','select match_stats.collect_online()');
select cron.schedule('jinrocard-match-stats-cleanup','23 * * * *','select match_stats.cleanup()');
