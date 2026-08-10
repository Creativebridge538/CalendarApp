-- 整理日を「キャストの設定画面での期間指定」から「シフト追加時にその日ごとチェック」する方式に変更する。
-- period_start_date/period_end_dateカラムはデータ保持のため残すが、アプリ側では今後参照しない。
alter table public.shifts add column is_period_day boolean not null default false;
