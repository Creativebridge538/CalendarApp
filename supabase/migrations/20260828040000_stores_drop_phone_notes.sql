-- 電話番号・備考は不要なため削除する
alter table public.stores
  drop column phone,
  drop column notes;
