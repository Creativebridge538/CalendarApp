-- 同じキャストが同じ時間帯に重複するシフトを提出/登録できてしまう問題をDBレベルで防ぐ。
-- 「同じルームでの二重予約」は既に shifts_no_double_booking で禁止しているが、
-- あれは status='confirmed' かつ同じルームの場合のみが対象で、ルームが違う・
-- 未確定（提出済み/下書き/修正依頼中）の場合は素通りしてしまっていた。
-- 一人の人間が同時刻に二つの場所で働くことはあり得ないため、却下(rejected)以外の
-- 全ステータスを対象に、同一キャストの時間帯重複そのものを禁止する。
-- 深夜営業をまたぐシフト（例: 19:00〜25:00はend_time=01:00として保存）も
-- 正しく重複判定できるよう、end_time <= start_time の場合は翌日跨ぎとして計算する。
alter table shifts add constraint shifts_no_self_overlap
  exclude using gist (
    cast_id with =,
    tsrange(
      (date + start_time)::timestamp,
      (date + end_time + (case when end_time <= start_time then interval '1 day' else interval '0' end))::timestamp,
      '[)'
    ) with &&
  )
  where (status <> 'rejected');
