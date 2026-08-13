-- handle_new_user()はlogin_id(UNIQUE制約あり)の仮値としてメールアドレスの@より前の部分を
-- そのまま使っていた。これが既存の別ユーザーのlogin_idと一致すると、UNIQUE制約違反で
-- auth.users への insert 自体が失敗し（トリガー内の例外はトランザクション全体を巻き戻すため）、
-- Supabase Authから「Database error creating new user」という生のエラーが返っていた。
-- この仮値はどのみち呼び出し元（キャスト作成API等）が直後に本来のlogin_idで上書きするだけの
-- プレースホルダーなので、衝突しようがない new.id（UUID）を使う。
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, login_id) values (new.id, new.email, new.id::text);
  return new;
end;
$$ language plpgsql security definer;
