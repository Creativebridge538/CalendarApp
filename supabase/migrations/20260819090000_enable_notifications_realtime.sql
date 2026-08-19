-- キャストのカレンダー画面のベルアイコンに未読件数をリアルタイム反映できるよう、
-- notificationsテーブルの変更をSupabase Realtimeで配信できるようにする。
-- 配信対象はRLSのSELECTポリシー（user_id = auth.uid()）でそのまま絞られるため、
-- 他ユーザーの通知が漏れて届くことはない。
alter publication supabase_realtime add table notifications;
