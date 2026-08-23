-- 支払通知書PDFをGoogle Driveへ保存する機能用。リフレッシュトークンは店舗の管理者のみ参照できるよう、
-- store_settingsとは別テーブルにする（store_settingsは所属ユーザー全員がselectできるポリシーがあるため）
create table store_google_drive_tokens (
  store_id      uuid primary key references stores(id) on delete cascade,
  refresh_token text not null,
  root_folder_id text,
  connected_by  uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table store_google_drive_tokens enable row level security;

create policy "store_google_drive_tokens: admin が同店舗を全操作" on store_google_drive_tokens for all
  using (store_id = my_store_id() and my_role() = 'admin');

create trigger trg_store_google_drive_tokens_updated_at before update on store_google_drive_tokens
  for each row execute function update_updated_at();
