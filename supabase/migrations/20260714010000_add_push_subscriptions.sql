-- Web Push (PWA通知) 購読情報
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user_id on push_subscriptions(user_id);

-- RLS: 本人のみ自分の購読を作成・削除・参照可能。送信はサーバー側(service role)から行うためポリシー不要
alter table push_subscriptions enable row level security;
create policy "push_subscriptions: 本人が全操作" on push_subscriptions for all
  using (user_id = auth.uid());
