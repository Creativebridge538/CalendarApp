-- シフト提出時の確認項目（チェックボックス）
create table shift_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_shift_checklist_items_store_id on shift_checklist_items(store_id);

-- RLS
alter table shift_checklist_items enable row level security;
create policy "shift_checklist_items: admin が全操作" on shift_checklist_items for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "shift_checklist_items: cast が有効分を参照" on shift_checklist_items for select
  using (store_id = my_store_id() and is_active = true);

-- shifts にチェック済み項目を記録
alter table shifts add column checklist_item_ids uuid[] not null default '{}';
