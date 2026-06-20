-- ランキング取得を DB 側で集計する。
-- 従来は API がそのチャートの全リザルトを取得してから JS で
-- ユーザー毎最高スコアを抽出しており、リザルト数に比例して遅くなっていた。
-- DISTINCT ON で必要な行だけを users JOIN 込みの 1 クエリで返す。

create or replace function get_chart_rankings(p_chart_id bigint)
returns table (
  id bigint,
  user_id bigint,
  score double precision,
  typing_speed double precision,
  backspace_count int,
  created_at timestamptz,
  name text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.user_id, r.score, r.typing_speed,
         coalesce(r.backspace_count, 0) as backspace_count,
         r.created_at, u.name
  from (
    select distinct on (user_id)
           id, user_id, score, typing_speed, backspace_count, created_at
    from results
    where chart_id = p_chart_id
    order by user_id, score desc, created_at asc
  ) r
  join users u on u.id = r.user_id
  order by r.score desc, r.created_at asc;
$$;

-- DISTINCT ON (user_id) ... order by score desc を効率化するためのインデックス
create index if not exists idx_results_chart_user_score
  on results (chart_id, user_id, score desc);
