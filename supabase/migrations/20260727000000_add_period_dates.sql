-- キャスト個人の整理日（直近1回分。次の周期になったら本人が上書き・削除する運用）
alter table public.users add column period_start_date date;
alter table public.users add column period_end_date date;
