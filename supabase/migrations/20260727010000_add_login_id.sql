-- メールアドレスの代わりにログインID(任意の文字列)でログインできるようにする
alter table public.users add column login_id text unique;

-- 既存ユーザーはメールアドレスの@より前の部分をバックフィル。重複する場合は連番を付与する
with backfill as (
  select id, split_part(email, '@', 1) as base_id,
    row_number() over (partition by split_part(email, '@', 1) order by created_at) as rn
  from public.users
  where login_id is null
)
update public.users u
set login_id = case when backfill.rn = 1 then backfill.base_id else backfill.base_id || backfill.rn::text end
from backfill
where u.id = backfill.id;

alter table public.users alter column login_id set not null;
