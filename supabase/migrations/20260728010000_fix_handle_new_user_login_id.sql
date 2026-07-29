-- login_idがNOT NULL化された後、新規サインアップ時のトリガーが更新されておらず
-- 「null value in column "login_id" violates not-null constraint」で全ての新規ユーザー作成が失敗していた。
-- メールのローカル部分を仮のlogin_idとして入れておき、アプリ側の後続update（cast作成APIやseed）で
-- 実際のlogin_idに上書きされる想定にする。
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, login_id) values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;
