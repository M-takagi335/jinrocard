create extension if not exists pg_cron;

create table public.online_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  host_id uuid not null,
  guest_id uuid check (guest_id <> host_id),
  request_id uuid not null,
  revision integer not null default 0,
  state jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  host_seen timestamptz not null default now(),
  guest_seen timestamptz,
  unique (host_id, request_id)
);
create index online_rooms_expiry on public.online_rooms(expires_at);
create index online_rooms_participants on public.online_rooms(host_id, guest_id);

create table public.online_rate (
  bucket text not null,
  minute timestamptz not null,
  hits integer not null,
  primary key (bucket, minute)
);
alter table public.online_rooms enable row level security;
alter table public.online_rate enable row level security;
revoke all on public.online_rooms, public.online_rate from public, anon, authenticated;
grant select, insert on public.online_rooms to service_role;

create function public.online_rate_hit(p_bucket text, p_limit integer) returns boolean
language sql security definer set search_path = '' as $$
  insert into public.online_rate(bucket, minute, hits)
    values (p_bucket, date_trunc('minute', now()), 1)
  on conflict (bucket, minute) do update set hits = public.online_rate.hits + 1
  returning hits <= p_limit
$$;

create function public.online_is_live(r public.online_rooms) returns boolean
language sql stable set search_path = '' as $$
  select r.expires_at > now() and (
    r.state->>'phase' <> 'playing'
    or (r.host_seen > now() - interval '30 minutes 45 seconds'
        and r.guest_seen > now() - interval '30 minutes 45 seconds')
  )
$$;

create function public.online_touch(p_id uuid, p_uid uuid) returns setof public.online_rooms
language sql security definer set search_path = '' as $$
  update public.online_rooms r
  set host_seen = case when r.host_id = p_uid then now() else r.host_seen end,
      guest_seen = case when r.guest_id = p_uid then now() else r.guest_seen end
  where r.id = p_id and p_uid in (r.host_id, r.guest_id) and public.online_is_live(r)
  returning r.*
$$;

create function public.online_commit(p_id uuid, p_revision integer, p_uid uuid, p_join boolean, p_state jsonb)
returns setof public.online_rooms language sql security definer set search_path = '' as $$
  update public.online_rooms r
  set revision = r.revision + 1,
      state = p_state,
      guest_id = case when p_join then p_uid else r.guest_id end,
      host_seen = case when r.host_id = p_uid then now() else r.host_seen end,
      guest_seen = case when p_join or r.guest_id = p_uid then now() else r.guest_seen end,
      expires_at = case
        when p_state->'left' = '[true,true]'::jsonb and r.state->'left' <> '[true,true]'::jsonb then now() + interval '5 minutes'
        when p_state->>'phase' = 'finished' and r.state->>'phase' <> 'finished' then now() + interval '30 minutes'
        when p_state->>'phase' = 'playing' then now() + interval '24 hours'
        else r.expires_at
      end
  where r.id = p_id and r.revision = p_revision and public.online_is_live(r)
    and ((not p_join and p_uid in (r.host_id, r.guest_id)) or
      (p_join and p_uid <> r.host_id and r.guest_id is null and r.state->>'phase' = 'lobby'
       and r.state->'left' = '[false,false]'::jsonb))
  returning r.*
$$;

revoke execute on function public.online_rate_hit(text, integer), public.online_touch(uuid, uuid),
  public.online_commit(uuid, integer, uuid, boolean, jsonb), public.online_is_live(public.online_rooms)
  from public, anon, authenticated;
grant execute on function public.online_rate_hit(text, integer), public.online_touch(uuid, uuid),
  public.online_commit(uuid, integer, uuid, boolean, jsonb) to service_role;

create function public.online_member(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.online_rooms r
    where 'duel:' || r.id::text = p_topic and public.online_is_live(r)
      and ((r.host_id = auth.uid() and r.state->'left'->>0 = 'false')
        or (r.guest_id = auth.uid() and r.state->'left'->>1 = 'false'))
  )
$$;
revoke execute on function public.online_member(text) from public, anon, authenticated;
grant execute on function public.online_member(text) to authenticated;
create policy "Members receive private duel notices" on realtime.messages for select to authenticated
  using (extension = 'broadcast' and public.online_member(realtime.topic()));

create function public.online_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revision <> old.revision then
    -- The only broadcast field is a revision. Polling also recovers a missing notification.
    begin
      perform realtime.send(jsonb_build_object('revision', new.revision), 'changed', 'duel:' || new.id::text, true);
    exception when others then
      raise warning 'Online duel notification could not be queued';
    end;
  end if;
  return new;
end
$$;
create trigger online_room_changed after update on public.online_rooms for each row execute function public.online_notify();

create function public.online_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.online_rooms r where not public.online_is_live(r);
  delete from public.online_rate where minute < now() - interval '1 hour';
end
$$;
revoke execute on function public.online_cleanup(), public.online_notify() from public, anon, authenticated;
select cron.schedule('jinrocard-online-cleanup', '* * * * *', 'select public.online_cleanup()');
