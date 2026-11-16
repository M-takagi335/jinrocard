-- Run in the SQL editor after applying the migration. All test data is rolled back.
begin;
do $$
declare
  a constant uuid := 'e0000000-0000-4000-8000-000000000001';
  b constant uuid := 'e0000000-0000-4000-8000-000000000002';
  c constant uuid := 'e0000000-0000-4000-8000-000000000003';
  r public.online_rooms;
  lobby constant jsonb := '{"phase":"lobby","left":[false,false]}'::jsonb;
  playing constant jsonb := '{"phase":"playing","left":[false,false]}'::jsonb;
  finished constant jsonb := '{"phase":"finished","left":[false,false]}'::jsonb;
begin
  assert not has_table_privilege('authenticated', 'public.online_rooms', 'select'), 'game row must not be readable';
  assert not has_table_privilege('anon', 'public.online_rooms', 'update'), 'game row must not be writable';
  assert not has_function_privilege('authenticated', 'public.online_commit(uuid,integer,uuid,boolean,jsonb)', 'execute'),
    'commit must only be callable by the server';
  insert into public.online_rooms(code, host_id, request_id, state)
    values ('QA2DUEL234', a, gen_random_uuid(), lobby) returning * into r;
  assert r.expires_at = now() + interval '30 minutes';
  assert (select count(*) from public.online_touch(r.id, c)) = 0, 'outsider must not read';
  assert (select count(*) from public.online_commit(r.id, 0, c, false, playing)) = 0;
  assert (select count(*) from public.online_commit(r.id, 0, b, true, lobby)) = 1, 'second seat';
  assert (select count(*) from public.online_commit(r.id, 1, c, true, lobby)) = 0, 'no third seat';
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c)::text, true);
  assert not public.online_member('duel:' || r.id::text), 'outsider must not receive notices';
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', b)::text, true);
  assert public.online_member('duel:' || r.id::text), 'member can receive notices';
  assert (select count(*) from public.online_commit(r.id, 1, a, false, playing)) = 1;
  assert (select count(*) from public.online_commit(r.id, 1, b, false, playing)) = 0, 'stale revision cannot commit';
  assert (select expires_at from public.online_rooms where id = r.id) = now() + interval '24 hours';
  update public.online_rooms set guest_seen = now() - interval '25 minutes' where id = r.id;
  assert (select count(*) from public.online_touch(r.id, b)) = 1, 'guest can reconnect within grace';
  update public.online_rooms set guest_seen = now() - interval '31 minutes' where id = r.id;
  assert (select count(*) from public.online_touch(r.id, b)) = 0, 'expired guest cannot revive';
  update public.online_rooms set guest_seen = now() where id = r.id;
  assert (select count(*) from public.online_commit(r.id, 2, a, false, finished)) = 1;
  assert (select expires_at from public.online_rooms where id = r.id) = now() + interval '30 minutes';
  assert (select count(*) from public.online_commit(r.id, 3, b, false, '{"phase":"finished","left":[true,true]}'::jsonb)) = 1;
  assert (select expires_at from public.online_rooms where id = r.id) = now() + interval '5 minutes';
  update public.online_rooms set expires_at = now() - interval '1 second' where id = r.id;
  assert (select count(*) from public.online_touch(r.id, a)) = 0, 'expired row blocked before cron';
  perform public.online_cleanup();
  perform public.online_cleanup();
  assert not exists(select 1 from public.online_rooms where id = r.id);
  assert public.online_rate_hit('qa-' || r.id, 1);
  assert not public.online_rate_hit('qa-' || r.id, 1);
end
$$;
rollback;
