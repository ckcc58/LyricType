-- chart_versions.chart_id に ON DELETE CASCADE を追加
-- charts を削除したとき chart_versions も自動削除されるようにする

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'chart_versions'::regclass
      and confrelid = 'charts'::regclass
      and contype = 'f'
  loop
    execute 'alter table chart_versions drop constraint ' || quote_ident(r.conname);
  end loop;
end;
$$;

alter table chart_versions
  add constraint chart_versions_chart_id_fkey
  foreign key (chart_id) references charts(id) on delete cascade;
