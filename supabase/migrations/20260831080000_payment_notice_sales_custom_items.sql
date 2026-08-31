-- 売上入力で登録した追加項目（sales.custom_items）を集計した表示専用の内訳を保持するカラム。
-- 既存のcustom_itemsは発行後の手動編集で追加する加算項目のまま据え置き、
-- base_reward側で既に加算済みの売上由来の項目とは二重計上にならないよう分離する
alter table public.payment_notices add column sales_custom_items jsonb not null default '[]'::jsonb;
