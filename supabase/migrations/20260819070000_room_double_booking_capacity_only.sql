-- 「同じルームの重複を許可」を店舗設定でON/OFFする方式は、設定をONにしないと
-- 収容人数を入れていても常に重複禁止のままになってしまい、紛らわしいので廃止する。
-- 今後はルームの収容人数（rooms.capacity）だけで判定する：
-- 収容人数が設定されていれば、その人数までは重複して確定できる。
-- 収容人数が未設定（NULL）のルームは、従来通り無制限に重複可能。

create or replace function check_shift_double_booking() returns trigger as $$
declare
  room_capacity integer;
  new_range tsrange;
  overlap_count integer;
begin
  if NEW.status <> 'confirmed' or NEW.room_id is null then
    return NEW;
  end if;

  select capacity into room_capacity from rooms where id = NEW.room_id;
  if room_capacity is null then
    return NEW;
  end if;

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

  if overlap_count + 1 > room_capacity then
    raise exception 'shifts_no_double_booking: overlapping confirmed shift exceeds room capacity'
      using errcode = '23P01';
  end if;

  return NEW;
end;
$$ language plpgsql;

alter table store_settings drop column if exists allow_room_double_booking;
