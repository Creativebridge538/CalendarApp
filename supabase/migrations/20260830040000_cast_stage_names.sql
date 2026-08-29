-- キャストが複数の源氏名を持つ場合に対応する（プラットフォームに紐付かない、単純な追加の源氏名）。
-- 売上登録のキャスト選択では、どの源氏名を選んでも同じキャストとして売上が登録される
create table public.cast_stage_names (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores(id) on delete cascade,
  cast_id    uuid not null references public.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (cast_id, name)
);

alter table public.cast_stage_names enable row level security;

create policy "cast_stage_names: admin が自店舗分を全操作" on public.cast_stage_names for all
  using (store_id = my_store_id() and my_role() = 'admin')
  with check (store_id = my_store_id() and my_role() = 'admin');
