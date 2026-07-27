-- 新しいブランドカラー(ブルー)をデフォルトの着せ替えに変更（既存ユーザーの選択値は変更しない）
alter table public.users alter column accent_skin set default 'blue';
