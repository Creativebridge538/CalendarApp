-- 「同じルームの重複を許可」設定がONのとき、無制限に重複できてしまっていたのを、
-- ルームの収容人数（rooms.capacity）を超えない範囲でのみ重複を許可するように変更する。
-- 収容人数が未設定（NULL）のルームは、従来通り無制限に重複可能なままとする。

create or replace function check_shift_double_booking() returns trigger as $$
declare
  allow_overlap boolean;
  room_capacity integer;
  new_range tsrange;
  overlap_count integer;
begin
  if NEW.status <> 'confirmed' or NEW.room_id is null then
    return NEW;
  end if;

  select allow_room_double_booking into allow_overlap
  from store_settings where store_id = NEW.store_id;

  new_range := tsrange(
    (NEW.date + NEW.start_time)::timestamp,
    (NEW.date + NEW.end_time + (case when NEW.end_time <= NEW.start_time then interval '1 day' else interval '0' end))::timestamp,
    '[)'
  );

  select count(*) into overlap_count
  from shifts shx
  where shx.id <> NEW.id
    and shx.store_id = NEW.store_id
    and shx.room_id = NEW.room_id
    and shx.status = 'confirmed'
    and tsrange(
      (shx.date + shx.start_time)::timestamp,
      (shx.date + shx.end_time + (case when shx.end_time <= shx.start_time then interval '1 day' else interval '0' end))::timestamp,
      '[)'
    ) && new_range;

  -- 設定行が無い場合はallow_overlapがNULLになり、以下は禁止扱い（従来どおりの安全側の挙動）
  if not allow_overlap then
    if overlap_count > 0 then
      raise exception 'shifts_no_double_booking: overlapping confirmed shift in the same room'
        using errcode = '23P01';
    end if;
    return NEW;
  end if;

  select capacity into room_capacity from rooms where id = NEW.room_id;

  if room_capacity is not null and overlap_count + 1 > room_capacity then
    raise exception 'shifts_no_double_booking: overlapping confirmed shift exceeds room capacity'
      using errcode = '23P01';
  end if;

  return NEW;
end;
$$ language plpgsql;
