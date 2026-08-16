-- notificationsのSELECTポリシーは「自分の通知のみ」に限定されており、管理者が自店舗キャストの
-- 通知（支払通知書を発行済みかどうかの確認など）を一切参照できなかった。
-- notifications.store_idは既存のinsert経路で一度も設定されていないため、それに頼らず
-- 受信者(user_id)が自店舗のユーザーであるかで判定する
create policy "notif: admin が同店舗ユーザー宛の通知を参照" on notifications for select
  using (
    my_role() = 'admin'
    and user_id in (select id from public.users where store_id = my_store_id())
  );
