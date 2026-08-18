-- 「同じルームでの確定シフト重複禁止」を店舗設定でON/OFFできるようにする。
-- これまでは shifts_no_double_booking というDBレベルのEXCLUDE制約で、
-- 全店舗一律に禁止していた。しかし空き枠の承認（vacant-slot-manager側）では
-- 引き続き重複を防ぎたい一方、シフトの直接確定（admin-shift-view側）では
-- 同じルームに複数人を確定できるようにしたい、という店舗ごとの運用差が出てきたため、
-- 店舗ごとにON/OFFできる設定に切り替える。
-- 空き枠承認側は、この設定に関わらず常にアプリ側で重複チェックを行う（アプリ側で担保）。

alter table store_settings add column allow_room_double_booking boolean not null default false;

create or replace function check_shift_double_booking() returns trigger as $$
declare
  allow_overlap boolean;
  new_range tsrange;
  conflict_exists boolean;
begin
  -- 元のEXCLUDE制約と同じ対象条件（確定済み・ルームありのみ）
  if NEW.status <> 'confirmed' or NEW.room_id is null then
    return NEW;
  end if;

  select allow_room_double_booking into allow_overlap
  from store_settings where store_id = NEW.store_id;

  -- 設定行が無い場合はallow_overlapがNULLになり、以下のIFはfalse扱いとなるため
  -- デフォルトで重複禁止（従来どおりの安全側の挙動）になる
  if allow_overlap then
    return NEW;
  end if;

  new_range := tsrange(
    (NEW.date + NEW.start_time)::timestamp,
    (NEW.date + NEW.end_time + (case when NEW.end_time <= NEW.start_time then interval '1 day' else interval '0' end))::timestamp,
    '[)'
  );

  select exists (
    select 1 from shifts s
    where s.id <> NEW.id
      and s.store_id = NEW.store_id
      and s.room_id = NEW.room_id
      and s.status = 'confirmed'
      and tsrange(
        (s.date + s.start_time)::timestamp,
        (s.date + s.end_time + (case when s.end_time <= s.start_time then interval '1 day' else interval '0' end))::timestamp,
        '[)'
      ) && new_range
  ) into conflict_exists;

  if conflict_exists then
    raise exception 'shifts_no_double_booking: overlapping confirmed shift in the same room'
      using errcode = '23P01';
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists shifts_check_double_booking on shifts;
create trigger shifts_check_double_booking
  before insert or update on shifts
  for each row execute function check_shift_double_booking();

alter table shifts drop constraint if exists shifts_no_double_booking;
