-- users.id を UUID から bigint generated always as identity へ変更する
--
-- 依存テーブル:
--   handle_reservations.profile_id -> users.id
--   charts.uploader_id             -> users.id
--   results.user_id                -> users.id
--
-- insert_result_full RPC も bigint 対応版に置き換える。
-- 関数本体は api/result/+server.ts の呼び出し引数から再構築しているため、
-- 実際の DB 定義と差異がある場合は適宜修正してください。

begin;

-- ① users に連番カラムを追加
alter table users add column _new_id bigint generated always as identity;

-- ② 各依存テーブルに一時カラムを追加
alter table handle_reservations add column _new_profile_id bigint;
alter table charts              add column _new_uploader_id bigint;
alter table results             add column _new_user_id     bigint;

-- ③ 新 ID を各テーブルへ伝播
update handle_reservations hr
set _new_profile_id = u._new_id
from users u
where hr.profile_id = u.id;

update charts c
set _new_uploader_id = u._new_id
from users u
where c.uploader_id = u.id;

update results r
set _new_user_id = u._new_id
from users u
where r.user_id = u.id;

-- ④ users.id を参照する FK 制約をすべて動的に削除
do $$
declare
  r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where confrelid = 'users'::regclass
      and contype = 'f'
  loop
    execute 'alter table ' || r.tbl || ' drop constraint ' || quote_ident(r.conname);
  end loop;
end;
$$;

-- ⑤ users の旧 UUID PK を削除し、新連番 ID を PK に昇格
alter table users drop constraint users_pkey;
alter table users drop column id;
alter table users rename column _new_id to id;
alter table users add primary key (id);

-- 既存の serial_id・avatar_url を削除
alter table users drop column if exists serial_id;
alter table users drop column if exists avatar_url;

-- ⑥ 依存テーブルの旧 UUID カラムを新 bigint カラムと差し替え
alter table handle_reservations drop column profile_id;
alter table handle_reservations rename column _new_profile_id to profile_id;
alter table handle_reservations alter column profile_id set not null;
alter table handle_reservations add constraint handle_reservations_profile_id_fkey
  foreign key (profile_id) references users(id) on delete cascade;

alter table charts drop column uploader_id;
alter table charts rename column _new_uploader_id to uploader_id;
alter table charts alter column uploader_id set not null;
alter table charts add constraint charts_uploader_id_fkey
  foreign key (uploader_id) references users(id);

alter table results drop column user_id;
alter table results rename column _new_user_id to user_id;
alter table results alter column user_id set not null;
alter table results add constraint results_user_id_fkey
  foreign key (user_id) references users(id);

-- ⑦ insert_result_full の旧シグネチャ（uuid版）をすべて削除
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'insert_result_full'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end;
$$;

-- ⑧ insert_result_full を bigint 版で再作成
create function insert_result_full(
  p_chart_id            bigint,
  p_user_id             bigint,
  p_lyric_data          jsonb,
  p_chart_hash          text,
  p_score               double precision,
  p_perfect_count       int,
  p_reading_match_count int,
  p_lost_count          int,
  p_typing_speed        double precision,
  p_total_phrases       int,
  p_key_events          jsonb,
  p_commit_events       jsonb,
  p_phrase_results      jsonb
) returns void
language plpgsql
security definer
as $$
declare
  v_result_id  bigint;
  v_version_id bigint;
begin
  -- 譜面バージョンのスナップショットを記録
  insert into chart_versions (chart_id, lyric_data)
  values (p_chart_id, p_lyric_data)
  returning id into v_version_id;

  -- 結果を挿入
  insert into results (
    chart_id, user_id, chart_version_id, chart_hash,
    score, perfect_count, reading_match_count, lost_count,
    typing_speed, total_phrases
  ) values (
    p_chart_id, p_user_id, v_version_id, p_chart_hash,
    p_score, p_perfect_count, p_reading_match_count, p_lost_count,
    p_typing_speed, p_total_phrases
  ) returning id into v_result_id;

  -- リプレイデータを挿入
  insert into replay_data (result_id, key_events, commit_events, phrase_results)
  values (v_result_id, p_key_events, p_commit_events, p_phrase_results);

  -- 譜面の集計カウントを更新
  update charts
  set play_count  = play_count  + 1,
      score_count = score_count + 1
  where id = p_chart_id;
end;
$$;

commit;
