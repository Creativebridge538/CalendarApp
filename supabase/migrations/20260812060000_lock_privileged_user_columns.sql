-- 重大な穴: "users: 自分のレコード更新可" ポリシーは id = auth.uid() という行単位の
-- 条件しか持たず、どの列を変更できるかは一切制限していなかった。RLSは行単位の制御であり
-- 列単位の制御ではないため、ログイン済みの一般キャストが自分自身の行に対して
-- role を 'admin' に、store_id を任意の他店舗のIDに書き換える直接APIコールが
-- 実際に通ってしまうことを確認した（本人昇格・他店舗への越境）。
--
-- BEFORE UPDATEトリガーで、「本人が自分自身の行を更新している」場合に限り、
-- 権限に関わる列(role, store_id, reward_rate, is_active)を更新前の値に強制的に戻す。
-- service_role(サーバーAPI)経由の更新はauth.uid()がnullになるため対象外。
-- admin が他ユーザー(別id)を更新するケースは auth.uid() <> old.id となり、
-- 通常通りRLSポリシー("admin が同店舗ユーザー更新可")の範囲で許可される。
create or replace function public.lock_privileged_user_columns()
returns trigger as $$
begin
  if auth.uid() = old.id then
    new.role := old.role;
    new.store_id := old.store_id;
    new.reward_rate := old.reward_rate;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_lock_privileged_user_columns
  before update on public.users
  for each row execute function public.lock_privileged_user_columns();
