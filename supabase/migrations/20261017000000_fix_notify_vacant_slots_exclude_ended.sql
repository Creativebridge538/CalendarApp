-- Push不具合③の修正（v18レビュー対応）: notify_vacant_slots の「通知対象の空き枠」判定が
-- is_published のみで、終了時刻（日またぎ対応）を見ていなかった。公開中の空き枠が全て
-- 終了済みの店舗でも「通知できる公開中の空き枠がありません」にならず、全アクティブキャストへ
-- 「空き枠が追加されました」という実態と異なる通知を送ってしまうバグがあった（DEVで再現確認済み。
-- docs/DEPLOYMENT_PLAN_vacant_slot_migration.md 55-c節）。
--
-- 修正: v_current_slots の取得クエリに、既存の public.vacant_slot_ends_at（キャスト画面の
-- isVacantSlotEnded と同じ日またぎ対応ロジックとして20260919000000で定義済み。他のSECURITY
-- DEFINER関数から内部的に呼ばれる前提のヘルパー）を使った終了時刻フィルタを追加する。これにより:
--   - 有効な空き枠が0件（全て終了済み、または公開枠が無い）なら、従来どおり例外を発生させ、
--     通知を作成しない。
--   - 有効な枠と終了済みの枠が混在する場合は、終了済みの枠を候補から除外し、有効な枠だけを
--     対象にする（v_current_slots・通知文面・vacant_slot_notify_logへの記録、いずれも有効な
--     枠のみを反映する）。
-- 上記以外のロジック（5秒ガード・組み合わせ一致による再送抑止・権限チェック等）は変更していない。

begin;

create or replace function public.notify_vacant_slots(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store         uuid := public.my_store_id();
  v_cast          uuid;
  v_notified      integer := 0;
  v_current_slots uuid[];
  v_last          record;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' or v_store is null then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vacant_slot_notify:' || v_store::text, 0));

  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_current_slots
  from public.vacant_slots
  where store_id = v_store and is_published
    and public.vacant_slot_ends_at(date, start_time, end_time) > timezone('Asia/Tokyo', now());

  if array_length(v_current_slots, 1) is null then
    raise exception '通知できる公開中の空き枠がありません' using errcode = 'P0002';
  end if;

  select * into v_last
  from public.vacant_slot_notify_log
  where store_id = v_store and notified_by = auth.uid() and created_at >= now() - interval '1 hour'
  order by created_at desc
  limit 1;

  if found and v_last.slot_ids = v_current_slots then
    -- 公開中の空き枠の組み合わせが、直前に送信したときと完全に一致している場合のみ、
    -- 「同じ状況への再送」とみなす。5秒以内はp_forceの値によらず常に重複として扱い
    -- （確認ダイアログの二重送信・通信再試行対策）、5秒を過ぎていればp_force=falseの間は
    -- 「送信済み」として知らせるだけに留め、p_force=trueのときだけ実際に再送する。
    if v_last.created_at >= now() - interval '5 seconds' then
      return jsonb_build_object('notified_count', v_last.notified_count, 'already_sent', true, 'notified_at', v_last.created_at);
    end if;
    if not p_force then
      return jsonb_build_object('notified_count', v_last.notified_count, 'already_sent', true, 'notified_at', v_last.created_at);
    end if;
  end if;

  for v_cast in
    select id from public.users where store_id = v_store and role = 'cast' and is_active order by id
  loop
    perform public.create_notification_internal(v_cast, '空き枠が追加されました', '空き枠が追加されました。空き枠一覧をご確認ください。', '/cast/vacant-slots');
    v_notified := v_notified + 1;
  end loop;

  insert into public.vacant_slot_notify_log (store_id, notified_by, slot_ids, notified_count)
  values (v_store, auth.uid(), v_current_slots, v_notified);

  return jsonb_build_object('notified_count', v_notified, 'already_sent', false, 'notified_at', now());
end;
$$;

revoke all on function public.notify_vacant_slots(boolean) from public, anon;
grant execute on function public.notify_vacant_slots(boolean) to authenticated;

commit;
