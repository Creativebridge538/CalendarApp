-- 「プラットフォーム別のID・源氏名」機能を廃止したため、テーブルを削除する
-- （本番データは0件であることを確認済み）
drop table if exists public.cast_platform_profiles;
