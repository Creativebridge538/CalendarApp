-- 店舗ごとに、どのライブ配信プラットフォーム（Stripchat/FC2/DXライブ）を採用しているか設定できるようにする。
-- 既存店舗は全プラットフォームが有効な状態を維持する（デフォルト値ですべて含む）
alter table public.store_settings
  add column enabled_platforms text[] not null default '{stripchat,fc2,dxlive}';
