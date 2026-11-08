-- Sweet Spot multi-game leaderboard (Phase 2).
-- Adds a run log for every game, a submit RPC that reuses the existing
-- player identity (sweet_spot_players id + secret), and a top-N RPC.
-- Baseball keeps its existing table and RPCs; those RPCs now also log
-- each run here so the landing page can show baseball's daily leader.

create table if not exists public.sweetspot_scores (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references public.sweet_spot_players(id) on delete cascade,
  game        text not null check (game in ('baseball','fieldgoal','pk','golf','drag')),
  mode        text not null default 'classic' check (mode ~ '^[a-z0-9-]{1,24}$'),
  initials    text check (initials ~ '^[A-Z0-9]{1,3}$'),
  score       integer not null,
  daily_seed  date,
  meta        jsonb not null default '{}'::jsonb check (pg_column_size(meta) < 16000),
  created_at  timestamptz not null default now()
);
create index if not exists sweetspot_scores_board on public.sweetspot_scores (game, mode, daily_seed, score);
create index if not exists sweetspot_scores_player on public.sweetspot_scores (player_id, created_at desc);

alter table public.sweetspot_scores enable row level security;
drop policy if exists "sweetspot scores are public" on public.sweetspot_scores;
create policy "sweetspot scores are public" on public.sweetspot_scores for select to anon, authenticated using (true);
revoke all on public.sweetspot_scores from anon, authenticated;
grant select on public.sweetspot_scores to anon, authenticated;

-- Golf course modes (strokes vs par) and drag (elapsed ms) rank ascending.
create or replace function public.sweetspot_lower_is_better(p_game text, p_mode text)
returns boolean language sql immutable set search_path = '' as $$
  select p_game = 'drag' or (p_game = 'golf' and p_mode like 'course-%');
$$;

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

-- Best run per player for a board. p_daily = null for all-time.
create or replace function public.sweetspot_top(p_game text, p_mode text, p_daily date default null, p_limit integer default 10)
returns table (rank bigint, player_id uuid, initials text, score integer, meta jsonb, created_at timestamptz)
language sql stable set search_path = '' as $$
  with best as (
    select distinct on (s.player_id) s.player_id, s.initials, s.score, s.meta, s.created_at
    from public.sweetspot_scores s
    where s.game = p_game and s.mode = p_mode and (p_daily is null or s.daily_seed = p_daily)
    order by s.player_id,
      case when public.sweetspot_lower_is_better(p_game, p_mode) then s.score else -s.score end,
      s.created_at
  )
  select row_number() over (order by case when public.sweetspot_lower_is_better(p_game, p_mode) then b.score else -b.score end, b.created_at),
         b.player_id, b.initials, b.score, b.meta, b.created_at
  from best b
  order by 1
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

revoke all on function public.sweetspot_submit(uuid, text, text, text, text, integer, boolean, jsonb) from public;
revoke all on function public.sweetspot_top(text, text, date, integer) from public;
grant execute on function public.sweetspot_submit(uuid, text, text, text, text, integer, boolean, jsonb) to anon, authenticated;
grant execute on function public.sweetspot_top(text, text, date, integer) to anon, authenticated;
grant execute on function public.sweetspot_lower_is_better(text, text) to anon, authenticated;

-- Baseball: log every scoring run into the shared table as well.
create or replace function public.sweet_spot_submit(p_id uuid, p_secret text, p_initials text, p_score integer, p_streak integer, p_hr integer, p_homers integer, p_pace integer[], p_daily boolean)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_hash text;
  v_row public.sweet_spot_players;
  v_today date := (now() at time zone 'utc')::date;
  v_pace integer[];
begin
  if p_id is null or p_secret is null or length(p_secret) < 20 or length(p_secret) > 128 then
    raise exception 'invalid player credentials';
  end if;
  if p_score < 0 or p_score > 2000000 or p_streak < 0 or p_streak > 2000
     or p_hr < 0 or p_hr > 520 or p_homers < 0 or p_homers > 2000 then
    raise exception 'run values out of range';
  end if;
  if p_initials is not null and p_initials !~ '^[A-Z0-9]{1,3}$' then
    p_initials := null;
  end if;
  v_pace := p_pace[1:400];
  v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');

  select * into v_row from public.sweet_spot_players where id = p_id for update;

  if not found then
    insert into public.sweet_spot_players
      (id, secret_hash, initials, best_score, best_streak, longest_hr, runs, homers, ghost, daily_date, daily_best, daily_ghost)
    values
      (p_id, v_hash, p_initials, p_score, p_streak, p_hr, 1, p_homers, v_pace,
       case when p_daily then v_today end,
       case when p_daily then p_score else 0 end,
       case when p_daily then v_pace end);
  else
    if v_row.secret_hash <> v_hash then
      raise exception 'player credentials do not match';
    end if;

    update public.sweet_spot_players set
      initials    = coalesce(p_initials, initials),
      ghost       = case when p_score > best_score then v_pace else ghost end,
      best_score  = greatest(best_score, p_score),
      best_streak = greatest(best_streak, p_streak),
      longest_hr  = greatest(longest_hr, p_hr),
      runs        = runs + 1,
      homers      = homers + p_homers,
      daily_ghost = case when p_daily and (daily_date is distinct from v_today or p_score > daily_best) then v_pace else daily_ghost end,
      daily_best  = case when p_daily and (daily_date is distinct from v_today or p_score > daily_best) then p_score else daily_best end,
      daily_date  = case when p_daily then v_today else daily_date end,
      updated_at  = now()
    where id = p_id;
  end if;

  if p_score > 0 then
    insert into public.sweetspot_scores (player_id, game, mode, initials, score, daily_seed, meta)
    values (p_id, 'baseball', 'classic', coalesce(p_initials, v_row.initials), p_score,
            case when p_daily then v_today end,
            jsonb_build_object('streak', p_streak, 'hr', p_hr, 'homers', p_homers));
  end if;
end;
$function$;

create or replace function public.sweet_spot_submit_derby(p_id uuid, p_secret text, p_initials text, p_score integer, p_homers integer, p_hr integer)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_hash text;
  v_row public.sweet_spot_players;
begin
  if p_id is null or p_secret is null or length(p_secret) < 20 or length(p_secret) > 128 then
    raise exception 'invalid player credentials';
  end if;
  if p_score < 0 or p_score > 2000000 or p_hr < 0 or p_hr > 520 or p_homers < 0 or p_homers > 2000 then
    raise exception 'run values out of range';
  end if;
  if p_initials is not null and p_initials !~ '^[A-Z0-9]{1,3}$' then
    p_initials := null;
  end if;
  v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');

  select * into v_row from public.sweet_spot_players where id = p_id for update;

  if not found then
    insert into public.sweet_spot_players
      (id, secret_hash, initials, longest_hr, runs, homers, derby_best, derby_homers)
    values
      (p_id, v_hash, p_initials, p_hr, 1, p_homers, p_score, p_homers);
  else
    if v_row.secret_hash <> v_hash then
      raise exception 'player credentials do not match';
    end if;

    update public.sweet_spot_players set
      initials     = coalesce(p_initials, initials),
      derby_homers = case when p_score > derby_best then p_homers else derby_homers end,
      derby_best   = greatest(derby_best, p_score),
      longest_hr   = greatest(longest_hr, p_hr),
      runs         = runs + 1,
      homers       = homers + p_homers,
      updated_at   = now()
    where id = p_id;
  end if;

  if p_score > 0 then
    insert into public.sweetspot_scores (player_id, game, mode, initials, score, meta)
    values (p_id, 'baseball', 'derby', coalesce(p_initials, v_row.initials), p_score,
            jsonb_build_object('homers', p_homers, 'hr', p_hr));
  end if;
end;
$function$;

-- Backfill existing baseball bests (one row per board the player is on).
insert into public.sweetspot_scores (player_id, game, mode, initials, score, daily_seed, meta, created_at)
select id, 'baseball', 'classic', initials, best_score, null,
       jsonb_build_object('streak', best_streak, 'hr', longest_hr, 'backfill', true), updated_at
from public.sweet_spot_players where best_score > 0
  and not exists (select 1 from public.sweetspot_scores s where s.game = 'baseball');
insert into public.sweetspot_scores (player_id, game, mode, initials, score, daily_seed, meta, created_at)
select id, 'baseball', 'classic', initials, daily_best, daily_date,
       jsonb_build_object('backfill', true), updated_at
from public.sweet_spot_players where daily_best > 0 and daily_date is not null
  and not exists (select 1 from public.sweetspot_scores s where s.game = 'baseball' and s.daily_seed is not null);
insert into public.sweetspot_scores (player_id, game, mode, initials, score, meta, created_at)
select id, 'baseball', 'derby', initials, derby_best,
       jsonb_build_object('homers', derby_homers, 'backfill', true), updated_at
from public.sweet_spot_players where derby_best > 0
  and not exists (select 1 from public.sweetspot_scores s where s.game = 'baseball' and s.mode = 'derby');
