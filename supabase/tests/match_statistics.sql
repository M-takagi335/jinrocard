begin;

do $$
declare
  uid uuid := '10000000-0000-4000-8000-000000000001';
  guest uuid := '10000000-0000-4000-8000-000000000002';
  start_key text;
  report uuid;
  room_id uuid;
  exit_id uuid;
  pre_start_id uuid;
  mark_count integer;
  summary jsonb;
  mode text;
begin
  if not has_function_privilege('anon','public.read_match_statistics()','EXECUTE') or
     has_function_privilege('authenticated','public.report_npc_match(uuid,uuid,text,text)','EXECUTE') or
     has_function_privilege('anon','public.report_npc_match(uuid,uuid,text,text)','EXECUTE') or
     has_table_privilege('anon','match_stats.totals','UPDATE') or
     has_table_privilege('authenticated','match_stats.npc_receipt','SELECT') then
    raise exception 'Statistics permissions are invalid';
  end if;
  if public.read_match_statistics() is not null then raise exception 'Feature must start disabled'; end if;

  update match_stats.config set started_at = now() - interval '1 hour', npc_enabled = true;
  start_key := lpad(to_hex(floor(extract(epoch from now())*1000)::bigint),12,'0');
  report := (substr(start_key,1,8)||'-'||substr(start_key,9,4)||'-7000-8000-000000000001')::uuid;
  if public.report_npc_match(uid,report,'npc_standard','win') <> 'accepted' then raise exception 'NPC accept'; end if;
  if public.report_npc_match(uid,report,'npc_standard','win') <> 'duplicate' then raise exception 'NPC duplicate'; end if;
  if public.report_npc_match(uid,report,'npc_standard','loss') <> 'conflict' then raise exception 'NPC conflict'; end if;
  if public.report_npc_match(guest,report,'npc_standard','win') <> 'conflict' then raise exception 'NPC foreign conflict'; end if;
  if public.report_npc_match(uid,report,'online','win') <> 'invalid' then raise exception 'NPC online spoof'; end if;
  if public.report_npc_match(uid,'00000000-0001-7000-8000-000000000000','npc_standard','win') <> 'invalid' then raise exception 'NPC expired'; end if;
  if public.report_npc_match(uid,'ffffffff-ffff-7000-8000-000000000000','npc_standard','win') <> 'invalid' then raise exception 'NPC future'; end if;
  foreach mode in array array['npc_easy','npc_strong','npc_strongest'] loop
    report := (substr(start_key,1,8)||'-'||substr(start_key,9,4)||'-7000-8000-00000000000'||
      (array_position(array['npc_easy','npc_strong','npc_strongest'],mode)+1))::uuid;
    if public.report_npc_match(uid,report,mode,'draw') <> 'accepted' then raise exception 'NPC category %', mode; end if;
  end loop;
  for i in 5..7 loop
    report := (substr(start_key,1,8)||'-'||substr(start_key,9,4)||'-7000-8000-00000000000'||i)::uuid;
    if public.report_npc_match(uid,report,'npc_standard','loss') <> (case when i=7 then 'limited' else 'accepted' end) then
      raise exception 'NPC limit %', i;
    end if;
  end loop;
  if (select finished from match_stats.totals where category='npc_standard') <> 3 then
    raise exception 'NPC totals double counted';
  end if;

  insert into public.online_rooms(code,host_id,guest_id,guest_seen,request_id,state)
    values ('FGHJ234567',uid,guest,now(),gen_random_uuid(),'{"phase":"playing","left":[false,false]}') returning id into room_id;
  perform public.online_commit(room_id,0,uid,false,'{"phase":"finished","departure":null,"left":[false,false],"_statsDraw":true}');
  if (select stats_draw from public.online_rooms where id = room_id) is distinct from true or
     (select state ? '_statsDraw' from public.online_rooms where id = room_id) then raise exception 'Missing or exposed marker'; end if;
  select count(*) into mark_count from public.online_commit(room_id,0,guest,false,'{"phase":"finished","departure":null,"left":[false,false],"_statsDraw":false}');
  if mark_count <> 0 then raise exception 'Stale revision succeeded'; end if;
  perform public.online_commit(room_id,1,guest,false,'{"phase":"finished","departure":null,"left":[false,true]}');
  insert into public.online_rooms(code,host_id,guest_id,guest_seen,request_id,state)
    values ('FGHJ234568',uid,guest,now(),gen_random_uuid(),'{"phase":"playing","left":[false,false]}') returning id into exit_id;
  perform public.online_commit(exit_id,0,uid,false,'{"phase":"finished","departure":0,"left":[true,false],"_statsDraw":false}');
  if (select stats_finished_at from public.online_rooms where id=exit_id) is not null then raise exception 'Departure counted'; end if;
  insert into public.online_rooms(code,host_id,guest_id,guest_seen,request_id,state)
    values ('FGHJ234569',uid,guest,now(),gen_random_uuid(),'{"phase":"finished","departure":null,"left":[false,false]}')
    returning id into pre_start_id;
  update public.online_rooms set stats_finished_at = now() - interval '1 day', stats_draw = false where id = pre_start_id;

  -- An aggregate failure rolls back the processed marker; the game already finished.
  delete from match_stats.totals where category = 'online';
  begin
    perform match_stats.collect_online();
    raise exception 'Expected aggregate failure';
  exception when raise_exception then
    if sqlerrm <> 'Online aggregate is missing' then raise; end if;
  end;
  if (select stats_counted_at from public.online_rooms where id=room_id) is not null then raise exception 'Lost pending marker'; end if;
  update public.online_rooms set expires_at = now() - interval '1 second' where id in (room_id,exit_id,pre_start_id);
  perform public.online_cleanup();
  if not exists (select 1 from public.online_rooms where id=room_id) or
    exists (select 1 from public.online_rooms where id=exit_id) then raise exception 'Cleanup policy invalid'; end if;
  insert into match_stats.totals(category) values ('online');
  if match_stats.collect_online() <> 2 or match_stats.collect_online() <> 0 then raise exception 'Online retry or duplicate'; end if;
  if not exists (select 1 from match_stats.totals where category='online' and finished=1 and draws=1) then raise exception 'Online totals'; end if;
  perform public.online_cleanup();
  if exists (select 1 from public.online_rooms where id in (room_id,pre_start_id)) then raise exception 'Processed room not cleaned'; end if;
  summary := public.read_match_statistics();
  if jsonb_array_length(summary->'rows') <> 5 or summary::text ~ 'FGHJ234567|10000000-0000|fingerprint|receipt' then
    raise exception 'Read projection leaks or omits data';
  end if;
end
$$;

rollback;
