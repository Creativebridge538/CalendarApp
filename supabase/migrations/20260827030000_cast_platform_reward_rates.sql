-- キャストの報酬率を、プラットフォーム（サイト）ごとに個別設定できるようにする。
-- 未設定のプラットフォームは、従来通りusers.reward_rate（基本報酬率）を使う。
alter table public.users
  add column platform_reward_rates jsonb not null default '{}'::jsonb;
