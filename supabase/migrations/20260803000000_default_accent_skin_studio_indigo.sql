-- 「着せ替え」の既定値をBootstrap的な生成感のある青(blue)から、作り込んだスタジオ配色に変更。
-- 既存ユーザーで一度も着せ替えを触っていない(=既定値のblueのままの)行も合わせて更新する。
-- 意図的にblueを選んでいたユーザーと区別できないが、この機能はリリース間もなく
-- 「blueのまま」は実質「未設定」と同義のため許容する。
alter table public.users alter column accent_skin set default 'studio-indigo';
update public.users set accent_skin = 'studio-indigo' where accent_skin = 'blue';
