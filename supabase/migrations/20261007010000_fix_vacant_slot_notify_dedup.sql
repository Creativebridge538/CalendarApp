-- notify_vacant_slots の重複防止ロジックを、固定10秒の時間窓から「直前に通知した時点の公開中の
-- 空き枠の組み合わせが変わっていないか」の判定へ強化する。
--
-- 背景: DEVでの実機確認で、通知ボタンの結果表示（アプリ内通知は成功・Push送信だけ失敗、の2つの
-- ポップアップがほぼ同時に出る）が分かりにくく、管理者が「送信できなかった」と誤認して複数回
-- ボタンを押した。1回目と2回目の押下間隔は実測で約16秒あり、前回の固定10秒ウィンドウでは
-- 重複として扱われず、新規の通知がもう1セット作られてしまった（キャストの通知一覧に2件残った）。
-- 画面側の表示分かりやすさは別途アプリコードで対応する（本migrationの対象外）。
--
-- 対策: 新規テーブル vacant_slot_notify_log に、通知を実際に送った時点の「公開中の空き枠IDの
-- 集合」を記録する。次回呼び出し時、直近1時間以内に同じ管理者がこの店舗へ送った記録があり、
-- かつそのときの空き枠の組み合わせが今回と完全に一致するなら、何秒経過していても重複として扱い、
-- 新規の通知を作らない（確認に手間取って数十秒〜数分かかっても確実に防げる）。空き枠を追加・
-- 削除・公開状態変更してから再送すれば、組み合わせが変わるため「意図的な再通知」として新規に
-- 送信される。1時間より前の送信は、管理者が後から同じ状況へ改めて意図的に再送したい場合を
-- 妨げないよう、重複とはみなさない。

begin;

create table public.vacant_slot_notify_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  notified_by uuid references public.users(id) on delete set null,
  slot_ids uuid[] not null,
  notified_count integer not null,
  created_at timestamptz not null default now()
);

alter table public.vacant_slot_notify_log enable row level security;
-- 直接のSELECT/INSERT等は誰にも許可しない（SECURITY DEFINER関数内からのみ参照・記録する）
revoke all on table public.vacant_slot_notify_log from public, anon, authenticated;

create index vacant_slot_notify_log_lookup on public.vacant_slot_notify_log (store_id, notified_by, created_at desc);

create or replace function public.notify_vacant_slots()
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
    return jsonb_build_object('notified_count', v_last.notified_count, 'duplicate', true);
  end if;

  for v_cast in
    select id from public.users where store_id = v_store and role = 'cast' and is_active order by id
  loop
    perform public.create_notification_internal(v_cast, '空き枠が追加されました', '空き枠が追加されました。空き枠一覧をご確認ください。', '/cast/vacant-slots');
    v_notified := v_notified + 1;
  end loop;

  insert into public.vacant_slot_notify_log (store_id, notified_by, slot_ids, notified_count)
  values (v_store, auth.uid(), v_current_slots, v_notified);

  return jsonb_build_object('notified_count', v_notified, 'duplicate', false);
end;
$$;

revoke all on function public.notify_vacant_slots() from public, anon;
grant execute on function public.notify_vacant_slots() to authenticated;

commit;

-- ロールバック用コメント（実行はしない。参考情報として記載）:
-- notify_vacant_slots を20261007000000時点の定義（固定10秒ウィンドウ版）へ戻し、
-- vacant_slot_notify_log を削除すれば、本migration適用前の挙動に戻せる。
-- drop table if exists public.vacant_slot_notify_log;
