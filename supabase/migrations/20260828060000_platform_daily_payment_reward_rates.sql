-- 前払い（日払い）時の報酬率をプラットフォームごとに設定できるようにする。
-- 既存の daily_payment_reward_rate（キャスト1人につき1つの前払い率）は
-- プラットフォーム別の設定がない場合のフォールバックとして引き続き使用する。
alter table public.users
  add column platform_daily_payment_reward_rates jsonb not null default '{}'::jsonb;
