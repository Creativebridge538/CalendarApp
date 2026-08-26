-- ルームは必ず1つのエリアに属するため、シフト/空き枠でルームだけ選んでエリアを
-- 選び忘れた場合は、ルームの所属エリアを自動的に補完する。
-- （アプリ側の複数箇所でarea_idのコピー漏れが繰り返し起きたため、DB側でも保険をかける）
create or replace function public.fill_area_from_room() returns trigger as $$
begin
  if new.area_id is null and new.room_id is not null then
    select area_id into new.area_id from public.rooms where id = new.room_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger shifts_fill_area_from_room
  before insert or update on public.shifts
  for each row execute function public.fill_area_from_room();

create trigger vacant_slots_fill_area_from_room
  before insert or update on public.vacant_slots
  for each row execute function public.fill_area_from_room();

-- 既存データの補完（ルームの所属エリアから復元できるものだけ）
update public.shifts s
set area_id = r.area_id
from public.rooms r
where s.room_id = r.id and s.area_id is null and r.area_id is not null;

update public.vacant_slots vs
set area_id = r.area_id
from public.rooms r
where vs.room_id = r.id and vs.area_id is null and r.area_id is not null;
