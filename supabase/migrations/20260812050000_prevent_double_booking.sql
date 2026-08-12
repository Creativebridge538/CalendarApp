-- 同じ店舗・同じルームで時間帯が重なる「確定」シフトを、DBレベルで禁止する。
-- これまで管理画面のタイムライン表示上でのみ、確定済み同士の重複を色で警告していたが、
-- それは「表示を見た人が気づくだけ」の後追いチェックであり、同時に別々の管理者が
-- 別々のシフトを確定した場合や、直接APIを叩いた場合には防げなかった。
-- 深夜営業をまたぐシフト（例: 19:00〜25:00は end_time=01:00として保存）も
-- 正しく重複判定できるよう、end_time <= start_time の場合は翌日跨ぎとして計算する。
create extension if not exists btree_gist;

alter table shifts add constraint shifts_no_double_booking
  exclude using gist (
    store_id with =,
    room_id with =,
    tsrange(
      (date + start_time)::timestamp,
      (date + end_time + (case when end_time <= start_time then interval '1 day' else interval '0' end))::timestamp,
      '[)'
    ) with &&
  )
  where (status = 'confirmed' and room_id is not null);
