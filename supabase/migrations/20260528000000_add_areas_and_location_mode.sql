
-- エリアテーブル追加
create table areas (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_areas_store_id on areas(store_id);

-- RLS
alter table areas enable row level security;
create policy "areas: admin が全操作" on areas for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "areas: cast が同店舗参照" on areas for select
  using (store_id = my_store_id());

-- rooms にエリア紐付け追加
alter table rooms add column area_id uuid references areas(id) on delete set null;

-- shifts にエリア紐付け追加（エリアのみモード用）
alter table shifts add column area_id uuid references areas(id) on delete set null;

-- store_settings にロケーションモード + ラベル追加
-- location_mode: 'none' | 'room' | 'area_only' | 'area_and_room'
alter table store_settings
  add column location_mode text not null default 'room',
  add column area_label    text not null default 'エリア',
  add column room_label    text not null default 'ルーム';
