-- login_idが全店舗共通で一意という制約になっていたため、他店舗で使われているIDは
-- 一切使えなかった。店舗ごとに一意であれば十分なので、制約を店舗単位に緩和する。
-- （ログイン時にIDだけでは店舗が一意に決まらなくなるケースが出るため、
-- resolve-login-id側で複数店舗ヒット時の店舗選択に対応する）
alter table public.users drop constraint if exists users_login_id_key;
create unique index users_store_id_login_id_key on public.users (store_id, login_id);
