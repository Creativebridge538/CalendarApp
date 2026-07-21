-- Googleカレンダー・TimeTree購読用のキャスト個別トークン
alter table public.users add column calendar_token text unique;
