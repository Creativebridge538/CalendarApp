-- notify_vacant_slots の「直近5秒は常に重複扱い」という安全弁が、空き枠の組み合わせが変わった
-- 場合にも無条件に適用されてしまい、「新しい空き枠を追加した直後に再送する」という正当な操作まで
-- ブロックしてしまうバグを修正する（自動化した回帰検証で発見。実際に以下の手順で再現した:
-- 送信→明示的な再送確認→再送(ここまでは正しい)→直後に新しい空き枠を追加→再送 のはずが、
-- 「組み合わせが変わった」判定に到達する前に、無条件の5秒ガードで弾かれていた）。
--
-- 修正: 「直近5秒以内」の安全弁も、「直前の送信と公開中の空き枠の組み合わせが完全に一致する場合」に
-- 限定する。組み合わせが異なれば、5秒以内であっても新規の送信として扱う（空き枠を追加・削除すれば
-- 即座に再通知できる、という元々の要件どおりになる）。組み合わせが同じ場合の「5秒以内は常に重複」
-- という安全弁（確認ダイアログの二重送信・通信再試行対策）自体は変更していない。

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
  from public.vacant_slots where store_id = v_store and is_published;

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
