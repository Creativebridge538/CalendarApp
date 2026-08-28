-- シフト管理画面から空き枠申請由来のシフトを確定した場合、
-- 空き枠申請（vacant_slot_applications）側が「保留中」のまま残ってしまうバグを修正する。
-- 確定操作の入口が複数あるため（シフト管理画面・修正依頼の却下など）、DBトリガーで一元的に同期する。
create or replace function public.sync_vacant_slot_application_on_shift_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and (old.status is distinct from 'confirmed') then
    update public.vacant_slot_applications
    set status = 'approved', reviewed_at = now()
    where shift_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_vacant_slot_application_on_shift_confirm on public.shifts;
create trigger trg_sync_vacant_slot_application_on_shift_confirm
  after update of status on public.shifts
  for each row
  execute function public.sync_vacant_slot_application_on_shift_confirm();
