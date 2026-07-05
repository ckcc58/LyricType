-- ============================================================================
-- results から未使用の集計列を削除する。
-- ----------------------------------------------------------------------------
-- perfect_count / reading_match_count / lost_count / total_phrases は
-- どこからも読み出されていない（get_chart_rankings も結果画面も未参照）。
-- 詳細な lost は統計側の play_logs.lost_phrases が保持するため results では不要。
--
-- ⚠ 破壊的変更: insert_result_full のシグネチャを変更する。デプロイ済みの旧アプリが
--   旧引数(p_perfect_count 等)で呼ぶと PostgREST が一致する関数を見つけられず、
--   リザルト登録が失敗する。必ず「列を削った新アプリコードのデプロイと同時または
--   その後」に本マイグレーションを適用すること。
-- ============================================================================

-- 1) 旧シグネチャ(14引数)の関数を削除
drop function if exists public.insert_result_full(
  integer, integer, jsonb, text, numeric, integer, integer, integer,
  numeric, integer, integer, jsonb, jsonb, jsonb
);

-- 2) results から未使用列を削除
alter table public.results
  drop column if exists perfect_count,
  drop column if exists reading_match_count,
  drop column if exists lost_count,
  drop column if exists total_phrases;

-- 3) 削減後のシグネチャ(10引数)で再作成。本体は results への該当列 insert を除いた以外
--    は従来通り（chart_versions の解決 → results → replay_data）。
create function public.insert_result_full(
  p_chart_id        integer,
  p_user_id         integer,
  p_lyric_data      jsonb,
  p_chart_hash      text,
  p_score           numeric,
  p_typing_speed    numeric,
  p_backspace_count integer,
  p_key_events      jsonb,
  p_commit_events   jsonb,
  p_phrase_results  jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id  integer;
  v_result_id   integer;
  v_version_num integer;
begin
  select id into v_version_id
  from public.chart_versions
  where chart_id = p_chart_id
    and chart_hash = p_chart_hash;

  if not found then
    select coalesce(max(version), 0) + 1 into v_version_num
    from public.chart_versions
    where chart_id = p_chart_id;

    insert into public.chart_versions (chart_id, version, chart_hash, lyric_data)
    values (p_chart_id, v_version_num, p_chart_hash, p_lyric_data)
    returning id into v_version_id;
  end if;

  insert into public.results (
    chart_id, chart_version_id, user_id, score, typing_speed, backspace_count
  )
  values (
    p_chart_id, v_version_id, p_user_id, p_score, p_typing_speed, p_backspace_count
  )
  returning id into v_result_id;

  insert into public.replay_data (result_id, key_events, commit_events, phrase_results)
  values (v_result_id, p_key_events, p_commit_events, p_phrase_results);
end;
$$;

-- 4) 実行権限。リザルト登録はサーバ(/api/result, service_role)経由のみなので、
--    旧定義が anon/authenticated にも付与していた execute は引き継がず service_role
--    のみに絞る（公開キーから任意 user_id でリザルト捏造される経路を塞ぐ）。
revoke execute on function public.insert_result_full(
  integer, integer, jsonb, text, numeric, numeric, integer, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.insert_result_full(
  integer, integer, jsonb, text, numeric, numeric, integer, jsonb, jsonb, jsonb
) to service_role;
