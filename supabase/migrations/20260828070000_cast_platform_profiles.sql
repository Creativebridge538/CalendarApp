-- 同一キャストでもプラットフォームごとにID・源氏名が異なるケースに対応する。
-- これまでは同じキャストをプラットフォームごとに別人として登録するしかなく、
-- 支払通知書・報酬計算も分裂してしまっていた。1人のキャストに対して
-- プラットフォームごとのID・源氏名を複数登録できるようにし、報酬・支払通知書は
-- 引き続き同一人物（1つのusersレコード）として合算される。
create table public.cast_platform_profiles (
  id                     uuid primary key default gen_random_uuid(),
  store_id               uuid not null references public.stores(id) on delete cascade,
  cast_id                uuid not null references public.users(id) on delete cascade,
  platform               text not null,
  platform_user_id       text,
  platform_display_name  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (cast_id, platform)
);

alter table public.cast_platform_profiles enable row level security;

create policy "cast_platform_profiles: admin が自店舗分を全操作" on public.cast_platform_profiles for all
  using (store_id = my_store_id() and my_role() = 'admin')
  with check (store_id = my_store_id() and my_role() = 'admin');
create policy "cast_platform_profiles: cast が自分の分を閲覧" on public.cast_platform_profiles for select
  using (cast_id = auth.uid());
