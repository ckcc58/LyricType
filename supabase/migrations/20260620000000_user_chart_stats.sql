-- ============================================================================
-- ユーザー統計（プレイ回数 / 打鍵数 / プレイ時間 / 難所）
-- ----------------------------------------------------------------------------
-- 設計方針（ハイブリッド）:
--   * 集計カウンタ方式（user_stats / user_chart_stats / user_daily_stats /
--     user_key_stats）で「累計値」を即時に見られるようにする。
--   * 完走プレイは play_logs に1行ずつ残し、難所(lost)や推移の分析に使う。
--   * source で 'chart'（公開譜面）と 'local'（ローカル練習）を分けて記録する。
--     ローカル練習は譜面が永続化されないため chart 単位の集計は持たない
--     （user_chart_stats は source='chart' のみ）。
--
-- カウントの定義:
--   start_count  … start() した回数（リトライ後の再開を含む）
--   retry_count  … リトライした回数
--   finish_count … result まで到達（完走）した回数
--   keystrokes   … 生のキー入力数（全プレイ＝中断・リトライ分も含む）
--   play_ms      … プレイ時間ミリ秒（全プレイ）
--
-- 注: 本ファイルは「純追加」のみ。results テーブル及び insert_result_full は
--     一切変更しない（本番デプロイ済みアプリと無関係＝ゼロリスク）。
--     results の lost_phrases 化／列削減は別マイグレーションで扱う。
-- ============================================================================

-- source の許容値を1か所で定義（CHECK 制約で各テーブルに適用）
do $$ begin
  if not exists (select 1 from pg_type where typname = 'stat_source') then
    create type stat_source as enum ('chart', 'local');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) user_stats : ユーザー×source の生涯累計（/user の上部サマリ用）
-- ---------------------------------------------------------------------------
create table if not exists user_stats (
  user_id        integer     not null references users(id) on delete cascade,
  source         stat_source not null,
  start_count    integer     not null default 0,
  retry_count    integer     not null default 0,
  finish_count   integer     not null default 0,
  keystrokes     bigint      not null default 0,
  play_ms        bigint      not null default 0,
  last_played_at timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, source)
);

-- ---------------------------------------------------------------------------
-- 2) user_chart_stats : ユーザー×公開譜面ごと（source='chart' 専用）
-- ---------------------------------------------------------------------------
create table if not exists user_chart_stats (
  user_id        integer     not null references users(id)  on delete cascade,
  chart_id       integer     not null references charts(id) on delete cascade,
  start_count    integer     not null default 0,
  retry_count    integer     not null default 0,
  finish_count   integer     not null default 0,
  keystrokes     bigint      not null default 0,
  play_ms        bigint      not null default 0,
  last_played_at timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, chart_id)
);
create index if not exists idx_user_chart_stats_user on user_chart_stats (user_id);

-- ---------------------------------------------------------------------------
-- 3) user_key_stats : ユーザー×source×キー の打鍵数（キー別ヒートマップ用）
-- ---------------------------------------------------------------------------
create table if not exists user_key_stats (
  user_id    integer     not null references users(id) on delete cascade,
  source     stat_source not null,
  key        text        not null,
  count      bigint      not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, source, key)
);

-- ---------------------------------------------------------------------------
-- 4) user_daily_stats : ユーザー×日付×source の日次集計（推移グラフ用）
-- ---------------------------------------------------------------------------
create table if not exists user_daily_stats (
  user_id      integer     not null references users(id) on delete cascade,
  day          date        not null,
  source       stat_source not null,
  start_count  integer     not null default 0,
  retry_count  integer     not null default 0,
  finish_count integer     not null default 0,
  keystrokes   bigint      not null default 0,
  play_ms      bigint      not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day, source)
);

-- ---------------------------------------------------------------------------
-- 5) play_logs : 完走プレイ1件＝1行（難所・推移の分析用）
--    lost_phrases は lost したフレーズの index（chart.lyric 配列の添字）。
--    記号のみフレーズは isEmptyPhrase でクライアント側が除外済み。
-- ---------------------------------------------------------------------------
create table if not exists play_logs (
  id           bigint generated always as identity primary key,
  user_id      integer     not null references users(id)  on delete cascade,
  chart_id     integer     references charts(id)          on delete set null, -- local は null
  source       stat_source not null,
  score        numeric,                       -- 任意（記録時のスコア）
  keystrokes   integer     not null default 0,-- そのプレイ単体の打鍵数
  play_ms      bigint      not null default 0,-- そのプレイ単体の時間
  lost_phrases integer[]   not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists idx_play_logs_user_created on play_logs (user_id, created_at desc);
create index if not exists idx_play_logs_chart_user   on play_logs (chart_id, user_id);

-- ===========================================================================
-- RPC
-- ===========================================================================

-- 汎用カウンタ加算。start / retry / 完走 / 中断フラッシュ すべてで使う。
-- 全カウンタ引数は「加算する差分」。p_chart_id が null の場合は譜面別集計を
-- スキップ（ローカル練習）。p_key_counts は {キー: 回数} の JSON（null 可）。
create or replace function bump_play_stats(
  p_user_id    integer,
  p_chart_id   integer,
  p_source     stat_source,
  p_start      integer,
  p_retry      integer,
  p_finish     integer,
  p_keystrokes bigint,
  p_play_ms    bigint,
  p_key_counts jsonb default null,
  p_day        date  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day  date := coalesce(p_day, current_date);
  v_now  timestamptz := now();
  v_s    integer := greatest(coalesce(p_start, 0), 0);
  v_r    integer := greatest(coalesce(p_retry, 0), 0);
  v_f    integer := greatest(coalesce(p_finish, 0), 0);
  v_k    bigint  := greatest(coalesce(p_keystrokes, 0), 0);
  v_ms   bigint  := greatest(coalesce(p_play_ms, 0), 0);
  v_played boolean := (v_s + v_r + v_f) > 0;
begin
  -- user_stats（source別 生涯累計）
  insert into user_stats as s
    (user_id, source, start_count, retry_count, finish_count, keystrokes, play_ms, last_played_at, updated_at)
  values
    (p_user_id, p_source, v_s, v_r, v_f, v_k, v_ms, case when v_played then v_now end, v_now)
  on conflict (user_id, source) do update set
    start_count    = s.start_count  + v_s,
    retry_count    = s.retry_count  + v_r,
    finish_count   = s.finish_count + v_f,
    keystrokes     = s.keystrokes   + v_k,
    play_ms        = s.play_ms      + v_ms,
    last_played_at = case when v_played then v_now else s.last_played_at end,
    updated_at     = v_now;

  -- user_chart_stats（公開譜面のみ）
  if p_chart_id is not null then
    insert into user_chart_stats as c
      (user_id, chart_id, start_count, retry_count, finish_count, keystrokes, play_ms, last_played_at, updated_at)
    values
      (p_user_id, p_chart_id, v_s, v_r, v_f, v_k, v_ms, case when v_played then v_now end, v_now)
    on conflict (user_id, chart_id) do update set
      start_count    = c.start_count  + v_s,
      retry_count    = c.retry_count  + v_r,
      finish_count   = c.finish_count + v_f,
      keystrokes     = c.keystrokes   + v_k,
      play_ms        = c.play_ms      + v_ms,
      last_played_at = case when v_played then v_now else c.last_played_at end,
      updated_at     = v_now;
  end if;

  -- user_daily_stats（日次）
  insert into user_daily_stats as d
    (user_id, day, source, start_count, retry_count, finish_count, keystrokes, play_ms, updated_at)
  values
    (p_user_id, v_day, p_source, v_s, v_r, v_f, v_k, v_ms, v_now)
  on conflict (user_id, day, source) do update set
    start_count  = d.start_count  + v_s,
    retry_count  = d.retry_count  + v_r,
    finish_count = d.finish_count + v_f,
    keystrokes   = d.keystrokes   + v_k,
    play_ms      = d.play_ms      + v_ms,
    updated_at   = v_now;

  -- user_key_stats（キー別打鍵）
  if p_key_counts is not null then
    insert into user_key_stats as k (user_id, source, key, count, updated_at)
    select p_user_id, p_source, kv.key, greatest((kv.value)::bigint, 0), v_now
    from jsonb_each_text(p_key_counts) as kv(key, value)
    where (kv.value)::bigint > 0
    on conflict (user_id, source, key) do update set
      count      = k.count + excluded.count,
      updated_at = v_now;
  end if;
end;
$$;

-- 完走プレイを1行記録する（カウンタ加算とは別に呼ぶ）。
create or replace function insert_play_log(
  p_user_id      integer,
  p_chart_id     integer,
  p_source       stat_source,
  p_score        numeric,
  p_keystrokes   integer,
  p_play_ms      bigint,
  p_lost_phrases integer[]
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into play_logs (user_id, chart_id, source, score, keystrokes, play_ms, lost_phrases)
  values (p_user_id, p_chart_id, p_source, p_score,
          greatest(coalesce(p_keystrokes, 0), 0),
          greatest(coalesce(p_play_ms, 0), 0),
          coalesce(p_lost_phrases, '{}'))
  returning id;
$$;

-- /user 上部サマリ：source別の累計を返す（chart / local の2行まで）。
create or replace function get_user_stats(p_user_id integer)
returns table (
  source         stat_source,
  start_count    bigint,
  retry_count    bigint,
  finish_count   bigint,
  keystrokes     bigint,
  play_ms        bigint,
  charts_played  bigint,        -- そのsourceで挑戦したユニーク譜面数（local は 0）
  last_played_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.source,
    s.start_count::bigint,
    s.retry_count::bigint,
    s.finish_count::bigint,
    s.keystrokes,
    s.play_ms,
    coalesce((
      select count(*) from user_chart_stats c
      where c.user_id = s.user_id and s.source = 'chart'
    ), 0) as charts_played,
    s.last_played_at
  from user_stats s
  where s.user_id = p_user_id
  order by s.source;
$$;

-- /user 譜面別内訳：よくプレイした順に上位 N 件（譜面タイトル・サムネ用 video_id 同梱）。
-- 戻り値の列を変えるため、再適用時のために drop してから作り直す。
drop function if exists get_user_chart_breakdown(integer, integer);
create function get_user_chart_breakdown(p_user_id integer, p_limit integer)
returns table (
  chart_id         integer,
  title            text,
  artist           text,
  youtube_video_id text,
  start_count      integer,
  retry_count      integer,
  finish_count     integer,
  keystrokes       bigint,
  play_ms          bigint,
  last_played_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.chart_id, ch.title, ch.artist, ch.youtube_video_id,
         c.start_count, c.retry_count, c.finish_count,
         c.keystrokes, c.play_ms, c.last_played_at
  from user_chart_stats c
  join charts ch on ch.id = c.chart_id
  where c.user_id = p_user_id
  order by c.start_count desc, c.last_played_at desc nulls last
  limit greatest(coalesce(p_limit, 20), 1);
$$;

-- ===========================================================================
-- セキュリティ: 上記 RPC はすべて security definer。Supabase は ALTER DEFAULT
-- PRIVILEGES で関数作成時に anon / authenticated へ明示的に execute を付与するため、
-- public からの revoke だけでは消えない。放置すると PostgREST 経由で公開 anon
-- キーから任意 p_user_id を渡して統計の改ざん・他ユーザー統計の閲覧が可能になる。
-- これらは必ずサーバ(service_role)経由でのみ呼ぶ設計なので、public / anon /
-- authenticated から実行権限を剥奪し service_role にのみ付与する。
-- ===========================================================================
revoke execute on function bump_play_stats(integer, integer, stat_source, integer, integer, integer, bigint, bigint, jsonb, date) from public, anon, authenticated;
revoke execute on function insert_play_log(integer, integer, stat_source, numeric, integer, bigint, integer[]) from public, anon, authenticated;
revoke execute on function get_user_stats(integer) from public, anon, authenticated;
revoke execute on function get_user_chart_breakdown(integer, integer) from public, anon, authenticated;

grant execute on function bump_play_stats(integer, integer, stat_source, integer, integer, integer, bigint, bigint, jsonb, date) to service_role;
grant execute on function insert_play_log(integer, integer, stat_source, numeric, integer, bigint, integer[]) to service_role;
grant execute on function get_user_stats(integer) to service_role;
grant execute on function get_user_chart_breakdown(integer, integer) to service_role;
