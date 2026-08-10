-- 新規プロジェクトへマイグレーションだけを適用した場合、service_role に対する
-- public スキーマのテーブル権限が(元のプロジェクトでは手動/初期設定で付与されていたため)
-- 欠落することが判明した。service_role はRLSをバイパスする前提で全APIルートの
-- admin clientから使われているため、明示的に権限を付与しておく。
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
