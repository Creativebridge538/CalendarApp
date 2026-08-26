-- 支払通知書の内容（氏名・口座情報・報酬率など）は、これまで発行後もキャストの
-- 現在のusersレコードから毎回ライブ取得していたため、発行後に氏名や口座を変更すると
-- 過去に発行済みの通知書の内容まで変わってしまっていた。
-- 発行時点の内容をスナップショットとして保存し、以後はそちらを参照するようにする。
create table public.payment_notices (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores(id) on delete cascade,
  cast_id             uuid not null references public.users(id) on delete cascade,
  period_from         date not null,
  period_to           date not null,
  issued_at           timestamptz not null default now(),
  issued_by           uuid references public.users(id) on delete set null,
  cast_name           text not null,
  cast_real_name      text not null,
  bank_name           text not null,
  bank_branch         text not null,
  bank_account_number text not null,
  bank_account_holder text not null,
  store_name          text not null,
  logo_url            text,
  reward_rate         numeric not null,
  sales_rows          jsonb not null,
  sales_total         numeric not null,
  base_reward         numeric not null,
  bonus               numeric not null,
  deduction           numeric not null,
  total_reward        numeric not null,
  unique (store_id, cast_id, period_from, period_to)
);

alter table public.payment_notices enable row level security;

create policy "payment_notices: admin が自店舗分を閲覧" on public.payment_notices for select
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "payment_notices: cast が自分の分を閲覧" on public.payment_notices for select
  using (cast_id = auth.uid());
-- insert/update/deleteはservice_role専用（発行APIがadmin clientで直接操作する）
