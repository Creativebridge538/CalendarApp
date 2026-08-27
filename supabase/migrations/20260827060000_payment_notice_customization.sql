-- 店舗ごとに支払通知書へ「売上合計」「報酬率」を載せるかどうかを選べるようにする
alter table public.store_settings
  add column notice_show_sales_total boolean not null default true,
  add column notice_show_reward_rate boolean not null default true;

-- 発行済み通知書（スナップショット）に、ドリンクバックなど任意の追加項目と、
-- 発行時点の表示設定（売上合計・報酬率を載せるか）を保持できるようにする
alter table public.payment_notices
  add column custom_items jsonb not null default '[]'::jsonb,
  add column show_sales_total boolean not null default true,
  add column show_reward_rate boolean not null default true;
