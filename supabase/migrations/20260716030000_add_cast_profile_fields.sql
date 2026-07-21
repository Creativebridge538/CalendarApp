-- キャストプロフィールの自由項目
create table cast_profile_fields (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_cast_profile_fields_store_id on cast_profile_fields(store_id);

alter table cast_profile_fields enable row level security;
create policy "cast_profile_fields: admin が全操作" on cast_profile_fields for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "cast_profile_fields: cast が有効分を参照" on cast_profile_fields for select
  using (store_id = my_store_id() and is_active = true);

-- キャストの回答値
alter table public.users add column profile_answers jsonb not null default '{}';

-- 既存バグ修正: 管理者が同店舗の他ユーザー(キャスト)を更新できるポリシーが無かったので追加
create policy "users: admin が同店舗ユーザー更新可" on public.users for update
  using (store_id = my_store_id() and my_role() = 'admin');
