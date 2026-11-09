-- Allow the Hockey Shootout game on the shared leaderboard.
alter table public.sweetspot_scores drop constraint if exists sweetspot_scores_game_check;
alter table public.sweetspot_scores add constraint sweetspot_scores_game_check
  check (game in ('baseball','fieldgoal','pk','hockey','golf','drag'));

create or replace function public.sweetspot_submit(
  p_id uuid, p_secret text, p_initials text,
  p_game text, p_mode text, p_score integer, p_daily boolean, p_meta jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_row public.sweet_spot_players;
  v_id bigint;
  v_ok boolean;
begin
  if p_id is null or p_secret is null or length(p_secret) < 20 or length(p_secret) > 128 then
    raise exception 'invalid player credentials';
  end if;
  if p_initials is not null and p_initials !~ '^[A-Z0-9]{1,3}$' then p_initials := null; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then p_meta := '{}'::jsonb; end if;

  v_ok := case
    when p_game = 'baseball'  then p_mode in ('classic','derby') and p_score between 0 and 2000000
    when p_game = 'fieldgoal' then p_mode = 'classic' and p_score between 0 and 200000
    when p_game = 'pk'        then p_mode = 'classic' and p_score between 0 and 50000
    when p_game = 'hockey'    then p_mode = 'classic' and p_score between 0 and 50000
    when p_game = 'golf'      then (p_mode in ('course-3','course-6','course-9','course-12','course-18') and p_score between -60 and 400)
                                  or (p_mode = 'arcade' and p_score between 0 and 100000)
    when p_game = 'drag'      then p_mode = 'classic' and p_score between 2500 and 120000
    else false end;
  if not coalesce(v_ok, false) then raise exception 'run values out of range'; end if;

  v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');
  select * into v_row from public.sweet_spot_players where id = p_id for update;
  if not found then
    insert into public.sweet_spot_players (id, secret_hash, initials) values (p_id, v_hash, p_initials);
  else
    if v_row.secret_hash <> v_hash then raise exception 'player credentials do not match'; end if;
    if exists (select 1 from public.sweetspot_scores where player_id = p_id and created_at > now() - interval '3 seconds') then
      raise exception 'slow down';
    end if;
    update public.sweet_spot_players set initials = coalesce(p_initials, initials), updated_at = now() where id = p_id;
    p_initials := coalesce(p_initials, v_row.initials);
  end if;

  insert into public.sweetspot_scores (player_id, game, mode, initials, score, daily_seed, meta)
  values (p_id, p_game, p_mode, p_initials, p_score,
          case when p_daily then (now() at time zone 'utc')::date end, p_meta)
  returning id into v_id;
  return v_id;
end;
$$;
