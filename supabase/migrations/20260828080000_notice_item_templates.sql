-- 支払通知書の追加項目（ボーナス・控除・ドリンクバックなど）を、発行のたびに手入力するのではなく、
-- 店舗ごとに事前に設定画面で登録しておけるようにする。
-- unit はその項目を入力する単位（円 or プラットフォームのトークン/ポイント）。
-- 円以外の場合、そのプラットフォームの換算式（platform-earnings.ts）で最終的に円換算される。
create table public.notice_item_templates (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  label       text not null,
  unit        text not null default 'jpy',
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.notice_item_templates enable row level security;

create policy "notice_item_templates: admin が自店舗分を全操作" on public.notice_item_templates for all
  using (store_id = my_store_id() and my_role() = 'admin')
  with check (store_id = my_store_id() and my_role() = 'admin');
