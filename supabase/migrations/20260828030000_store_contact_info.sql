-- ownerが店舗名以外の連絡先情報も編集できるよう、新規参加フォームで集めているのと
-- 同じ項目をstoresテーブルに持たせる
alter table public.stores
  add column contact_name text,
  add column contact_email text,
  add column phone text,
  add column notes text;
