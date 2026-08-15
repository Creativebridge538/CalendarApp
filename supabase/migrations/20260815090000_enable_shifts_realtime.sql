-- キャストのカレンダーで、管理者がシフトを確定/差し戻しした変更をリアルタイムに反映できるよう、
-- shiftsテーブルの変更をSupabase Realtimeで配信できるようにする。
-- 配信対象はRLSのSELECTポリシー（cast_id = auth.uid()）でそのまま絞られるため、
-- 他キャストのシフト変更が漏れて届くことはない。
alter publication supabase_realtime add table shifts;
-- UPDATE/DELETEイベントに変更前の全カラムを含める（cast_idでのフィルタ配信を確実にするため）
alter table shifts replica identity full;
