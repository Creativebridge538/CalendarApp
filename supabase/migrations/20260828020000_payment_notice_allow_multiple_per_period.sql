-- 「発行」は常に新しい独立した支払通知書を作成する運用に変更する。
-- 同じキャスト・同じ期間について複数回発行しても、過去に発行済みの通知書は
-- 一切変更されず、新しい発行のたびに別レコードとして残るようにする。
alter table public.payment_notices
  drop constraint payment_notices_store_id_cast_id_period_from_period_to_key;
