-- プラットフォームオーナーが店舗を利用停止/再開できるようにする
alter table public.stores add column is_active boolean not null default true;
