-- SaaS化: 新規店舗のセルフサーブ申込テーブル。
-- 承認されるまでログイン可能なアカウントは作られない（申込制）。
-- RLSは有効化するがポリシーは一切作らない。読み書きは createAdminClient() の
-- service role からのみ行う想定（公開フォームからの直接RLS書き込みは許可しない）。
create table public.store_signup_requests (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  contact_name text not null,
  contact_email text not null,
  phone text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_store_id uuid references public.stores(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.store_signup_requests enable row level security;
