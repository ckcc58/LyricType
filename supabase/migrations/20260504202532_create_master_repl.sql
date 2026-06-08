create table master_repl (
  id           bigint primary key generated always as identity,
  key          text not null unique,
  reading      text not null,
  status       text not null default 'verified',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index master_repl_key_idx on master_repl (key);
create index master_repl_updated_at_idx on master_repl (updated_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger master_repl_updated_at
before update on master_repl
for each row execute function set_updated_at();

alter table master_repl enable row level security;
create policy master_repl_read on master_repl for select to anon, authenticated using (true);
