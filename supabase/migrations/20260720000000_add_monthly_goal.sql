-- キャストが自分で設定する月間収益目標（収益ダッシュボードの進捗バー用）
alter table public.users add column monthly_goal numeric(12, 2);
