-- notify_vacant_slots の重複防止を「静かにブロックするだけ」から「送信済みであることを示し、
-- 管理者が明示的に選べば再送できる」方式へ変更する。
--
-- 背景（27節からの継続）: 前回の「公開中の空き枠の組み合わせが変わっていなければ常にブロックする」
-- 方式は、連打・通信再試行は防げるが、管理者が「内容は同じでも、念のためもう一度知らせたい」と
-- 意図的に再送したい場合に、空き枠を一度編集しないと再送できないという不便があった。
--
-- 対策: notify_vacant_slots に p_force 引数を追加する。
--   - p_force=false（既定）: 直近1時間以内に同じ管理者が同じ公開中の空き枠の組み合わせへ送信済みなら、
--     新規の通知は作らず、already_sent=true とそのときの件数を返す（実際には送信しない。
--     「送信するかどうか」はアプリ側が管理者に確認してから判断する）。
--   - p_force=true: 上記の重複判定をスキップし、必ず新規に通知を作成する
--     （管理者が明示的に「もう一度通知する」を選んだ場合に使う）。
--   - p_forceの値によらず、直近5秒以内に同じ管理者がこの店舗へ送信済みなら、常に重複として扱い
--     新規作成しない（確認ダイアログの二重送信・通信再試行など、ごく短時間の完全な取り違えのみを
--     防ぐための安全弁。「意図的な再送か」の判断はこの5秒を超える間隔であれば常にp_forceに委ねる）。

begin;

-- 引数無し版 notify_vacant_slots() と、これから作る notify_vacant_slots(boolean) は、
-- デフォルト値があっても別シグネチャとして共存してしまい、引数無しで呼んだときにどちらを指すか
-- 曖昧になる（PostgRESTがエラーにする）。旧シグネチャを明示的に削除してから新シグネチャを作る。
drop function if exists public.notify_vacant_slots();

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
  v_very_recent   record;
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

  -- 安全弁: p_forceの値によらず、直近5秒以内の送信があれば常に重複として扱う
  -- （確認ダイアログの二重送信・通信再試行対策）
  select * into v_very_recent
  from public.vacant_slot_notify_log
  where store_id = v_store and notified_by = auth.uid() and created_at >= now() - interval '5 seconds'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('notified_count', v_very_recent.notified_count, 'already_sent', true, 'notified_at', v_very_recent.created_at);
  end if;

  if not p_force then
    select * into v_last
    from public.vacant_slot_notify_log
    where store_id = v_store and notified_by = auth.uid() and created_at >= now() - interval '1 hour'
    order by created_at desc
    limit 1;

    if found and v_last.slot_ids = v_current_slots then
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

-- ロールバック用コメント（実行はしない。参考情報として記載）:
-- notify_vacant_slots(boolean) を削除し、notify_vacant_slots()（引数無し、20261007010000版）を
-- 再作成すれば、本migration適用前の挙動に戻せる。vacant_slot_notify_log のデータはそのまま使える
-- （列構成は変更していない）。
-- drop function if exists public.notify_vacant_slots(boolean);
