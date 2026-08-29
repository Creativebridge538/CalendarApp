-- 締切ルールの仕様を「締切曜日から7日間」に一本化したため、
-- 週の起点（deadline_week_start_day）は不要になった。
-- require_approval_after_deadlineはどこにも実装されていなかった設定のため、あわせて削除する
alter table public.store_settings
  drop column deadline_week_start_day,
  drop column require_approval_after_deadline;
