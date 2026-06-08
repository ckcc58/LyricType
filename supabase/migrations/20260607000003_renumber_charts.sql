-- charts.id を created_at 昇順で 1 から振り直す
-- 依存: chart_versions.chart_id, results.chart_id（空でも対応）

begin;

-- ① 新旧 ID マッピング（created_at 昇順、同値なら旧 id 昇順）
create temp table _chart_id_map as
select
  id                                                    as old_id,
  row_number() over (order by created_at, id)::bigint  as new_id
from charts;

-- ② charts を参照する FK 制約をすべて動的に削除
do $$
declare
  r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where confrelid = 'charts'::regclass
      and contype = 'f'
  loop
    execute 'alter table ' || r.tbl || ' drop constraint ' || quote_ident(r.conname);
  end loop;
end;
$$;

-- ③ serial の default / identity を一時解除・PK を一時削除
alter table charts alter column id drop identity if exists;
alter table charts alter column id drop default;
alter table charts drop constraint charts_pkey;

-- ④ 衝突を避けるため負値に退避してから新 ID に差し替え
update charts        set id       = -m.new_id from _chart_id_map m where id       = m.old_id;
update chart_versions set chart_id = -m.new_id from _chart_id_map m where chart_id = m.old_id;
update results        set chart_id = -m.new_id from _chart_id_map m where chart_id = m.old_id;

update charts         set id       = -id;
update chart_versions set chart_id = -chart_id;
update results        set chart_id = -chart_id;

-- ⑤ PK と identity を復元
alter table charts add primary key (id);

do $$
declare
  next_val bigint;
begin
  select max(id) + 1 into next_val from charts;
  execute 'alter table charts alter column id add generated always as identity (start with ' || next_val || ' restart with ' || next_val || ')';
end;
$$;

-- ⑥ FK を復元
alter table chart_versions add constraint chart_versions_chart_id_fkey
  foreign key (chart_id) references charts(id) on delete cascade;

alter table results add constraint results_chart_id_fkey
  foreign key (chart_id) references charts(id);

drop table _chart_id_map;

commit;
