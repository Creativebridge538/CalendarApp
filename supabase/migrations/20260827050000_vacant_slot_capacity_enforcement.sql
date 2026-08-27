-- キャストはRLSにより自分の申請しか見えないため、他キャストの承認済み件数を含めた
-- 「満員かどうか」の判定ができない。承認済み件数を vacant_slots 側に集計カラムとして
-- 持たせることで、公開分を参照できる全員（cast含む）に安全に見せられるようにする。
alter table public.vacant_slots
  add column approved_count integer not null default 0;

create or replace function public.sync_vacant_slot_approved_count(target_id uuid) returns void as $$
begin
  update public.vacant_slots
  set approved_count = (
    select count(*) from public.vacant_slot_applications
    where vacant_slot_id = target_id and status = 'approved'
  )
  where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.vacant_slot_applications_sync_approved_count() returns trigger as $$
begin
  if TG_OP = 'DELETE' then
    perform public.sync_vacant_slot_approved_count(old.vacant_slot_id);
    return old;
  end if;

  perform public.sync_vacant_slot_approved_count(new.vacant_slot_id);
  if TG_OP = 'UPDATE' and old.vacant_slot_id is distinct from new.vacant_slot_id then
    perform public.sync_vacant_slot_approved_count(old.vacant_slot_id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger vacant_slot_applications_sync_approved_count
  after insert or update or delete on public.vacant_slot_applications
  for each row execute function public.vacant_slot_applications_sync_approved_count();

update public.vacant_slots vs
set approved_count = (
  select count(*) from public.vacant_slot_applications vsa
  where vsa.vacant_slot_id = vs.id and vsa.status = 'approved'
);

-- 満員（承認済み件数が募集人数に達している）の空き枠への新規申請をDBレベルで拒否する。
-- クライアント側の「満員なら申請ボタンを出さない」制御は、他キャストの承認状況をRLSで
-- 見られない以上あてにならないため、最終防衛としてここで弾く。
create or replace function public.check_vacant_slot_capacity_before_apply() returns trigger as $$
declare
  slot_capacity integer;
  approved integer;
begin
  select capacity, approved_count into slot_capacity, approved
  from public.vacant_slots where id = new.vacant_slot_id;

  if approved >= slot_capacity then
    raise exception 'この空き枠は満員です' using errcode = '23514';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger vacant_slot_applications_check_capacity
  before insert on public.vacant_slot_applications
  for each row execute function public.check_vacant_slot_capacity_before_apply();
