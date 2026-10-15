-- 在 Supabase → SQL Editor 里整段运行一次。

create table if not exists public.manuscript (
  id int primary key check (id = 1),
  volumes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.manuscript (id, volumes)
values (1, '[]'::jsonb)
on conflict (id) do nothing;

create table if not exists public.editors (
  email text primary key
);

alter table public.manuscript enable row level security;
alter table public.editors enable row level security;

grant select on public.manuscript to anon, authenticated;
grant update on public.manuscript to authenticated;
grant select on public.editors to authenticated;

drop policy if exists "public read manuscript" on public.manuscript;
create policy "public read manuscript"
  on public.manuscript for select
  to anon, authenticated
  using (true);

drop policy if exists "editors update manuscript" on public.manuscript;
create policy "editors update manuscript"
  on public.manuscript for update
  to authenticated
  using (
    exists (
      select 1 from public.editors
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  with check (
    exists (
      select 1 from public.editors
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "read own editor row" on public.editors;
create policy "read own editor row"
  on public.editors for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- 把下面的邮箱换成你的，可以多写几行。只有这些邮箱能改稿。
-- insert into public.editors (email) values ('you@example.com');

do $$
begin
  alter publication supabase_realtime add table public.manuscript;
exception
  when duplicate_object then null;
end $$;
