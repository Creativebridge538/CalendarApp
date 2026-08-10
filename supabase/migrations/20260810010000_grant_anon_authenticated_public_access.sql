-- service_role同様、anon/authenticatedにもpublicスキーマの基本権限が
-- 新規プロジェクトでは付与されていなかった。RLSは全テーブルで有効になっている前提なので、
-- テーブル権限を付与してもRLSポリシーによる行単位の制御はそのまま効く。
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
