-- 空き枠の「作成・公開」と「キャストへの通知」を分離する。
--
-- 背景: 従来は create_vacant_slot（空き枠の作成）が、同じトランザクション内で同店舗の有効な
-- キャスト全員へ「空き枠が追加されました」のアプリ内通知を自動的に作成していた。空き枠を複数件
-- 作るたびに通知が積み重なるため、「作成・公開」と「通知の送信」を分離し、管理者がまとめて
-- 任意のタイミングで通知できるようにする。
--
-- 変更内容:
--   1. create_vacant_slot から通知作成ループを削除する（空き枠の作成のみを行う。戻り値から
--      notified_count を除く）。公開中の空き枠がキャスト一覧へ表示されるのは、既存のRLS・
--      Realtime（postgres_changes）の仕組みによるもので、通知の有無とは無関係のため、この
--      削除によって「通知なしでも一覧に表示される」動作に影響はない。
--   2. 新規関数 notify_vacant_slots() を追加する。呼び出した管理者の店舗の、公開中の空き枠が
--      1件もなければ失敗させる。公開中の空き枠が1件以上あれば、同店舗の有効なキャスト全員へ
--      固定文面の通知を1件ずつ作成する（空き枠ごとではなく、呼び出し1回につきキャスト1人あたり
--      1件）。連打・同じリクエストの再試行による重複作成を防ぐため、店舗単位のアドバイザリロックで
--      同時実行を直列化したうえで、同じ管理者がこの店舗へ直近10秒以内に同じ文面の通知をすでに
--      作成済みであれば、新規に作らず直前の結果をそのまま返す（何も再作成しない）。
--   3. Web Push（外部処理）は本migrationでは変更しない。既存の /api/push/dispatch ＋
--      claim_pending_push_notifications（created_by・push_sent_at is null・直近分数以内で
--      1回だけ確保して送る設計）をそのまま利用するため、notify_vacant_slots が作成した通知も
--      既存の仕組みでPush配信される（アプリ側が作成直後に dispatchPush() を呼ぶだけでよい）。
--      通知の作成（本migrationの対象）とPushの配信（既存の仕組み）が別処理である設計のおかげで、
--      「通知作成は成功・Push配信だけ失敗」の場合に再試行してもアプリ内通知が重複することはない
--      （再試行で dispatchPush() を呼び直しても、claim_pending_push_notifications は
--      push_sent_at が null のものだけを対象にするため、通知の再作成は発生しない）。
--
-- 申請が届いた通知・承認／却下の結果通知（apply_vacant_slot・review_vacant_slot_application）、
-- 空き枠の希望時間指定・日またぎ・募集人数・シフト重複防止・店舗権限、支払通知書の為替表示
-- ON/OFF・売上/報酬計算は、本migrationでは一切変更していない。

begin;

-- ---------------------------------------------------------------------------
-- 1. create_vacant_slot: 通知作成ループを削除し、空き枠の作成のみを行う
-- ---------------------------------------------------------------------------
create or replace function public.create_vacant_slot(
  p_date date,
  p_start_time time,
  p_end_time time,
  p_area_id uuid default null,
  p_room_id uuid default null,
  p_notes text default null,
  p_capacity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store    uuid := public.my_store_id();
  v_slot_id  uuid;
  v_room_cap integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' or v_store is null then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  if p_date is null or p_start_time is null or p_end_time is null then
    raise exception '日付・開始時刻・終了時刻は必須です' using errcode = '23514';
  end if;
  if p_start_time = p_end_time then
    raise exception '開始時刻と終了時刻に同じ時刻は指定できません' using errcode = '23514';
  end if;
  if extract(hour from p_start_time) >= 24 or extract(hour from p_end_time) >= 24 then
    raise exception '時刻は00:00〜23:59の範囲で指定してください' using errcode = '23514';
  end if;
  if p_capacity is null or p_capacity < 1 then
    raise exception '募集人数は1人以上で指定してください' using errcode = '23514';
  end if;

  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and store_id = v_store) then
    raise exception '指定されたエリアを利用できません' using errcode = '23503';
  end if;
  if p_room_id is not null then
    select capacity into v_room_cap from public.rooms where id = p_room_id and store_id = v_store;
    if not found then
      raise exception '指定されたルームを利用できません' using errcode = '23503';
    end if;
    if v_room_cap is not null and p_capacity > v_room_cap then
      raise exception 'このルームの定員は%人です', v_room_cap using errcode = '23514';
    end if;
  end if;

  insert into public.vacant_slots (store_id, created_by, date, start_time, end_time, area_id, room_id, notes, is_published, capacity)
  values (v_store, auth.uid(), p_date, p_start_time, p_end_time, p_area_id, p_room_id, nullif(p_notes, ''), true, p_capacity)
  returning id into v_slot_id;

  return jsonb_build_object('slot_id', v_slot_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. notify_vacant_slots: 管理者が任意のタイミングでまとめて通知する
-- ---------------------------------------------------------------------------
-- 戻り値: {"notified_count": n, "duplicate": boolean}
--   duplicate = true の場合、直近10秒以内の同一管理者による送信と判定し、新規の通知は作成していない
--   （notified_count はその直前の送信件数をそのまま返す）。
-- SECURITY DEFINER（理由: notificationsへの直接INSERTを閉じているため）。認可: ロールがadmin。
-- 宛先・文面・リンクはすべてDB側で固定する（呼び出し元は指定できない）。
create or replace function public.notify_vacant_slots()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store     uuid := public.my_store_id();
  v_cast      uuid;
  v_notified  integer := 0;
  v_recent_count integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' or v_store is null then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  -- 店舗単位で直列化する。同時に複数リクエストが来ても、下の重複判定・通知作成が1件ずつ順番に
  -- 処理されるため、連打・レースコンディションによる二重作成が起きない
  perform pg_advisory_xact_lock(hashtextextended('vacant_slot_notify:' || v_store::text, 0));

  -- 連打・同じリクエストの再試行対策: 自分がこの店舗へ直近10秒以内に同じ文面の通知を
  -- 作成済みなら、新規に作らず直前の結果をそのまま返す（アドバイザリロックで直列化済みのため、
  -- この判定自体に競合状態は生じない）
  select count(*) into v_recent_count
  from public.notifications
  where store_id = v_store and created_by = auth.uid()
    and title = '空き枠が追加されました' and created_at >= now() - interval '10 seconds';
  if v_recent_count > 0 then
    return jsonb_build_object('notified_count', v_recent_count, 'duplicate', true);
  end if;

  if not exists (select 1 from public.vacant_slots where store_id = v_store and is_published) then
    raise exception '通知できる公開中の空き枠がありません' using errcode = 'P0002';
  end if;

  for v_cast in
    select id from public.users where store_id = v_store and role = 'cast' and is_active order by id
  loop
    perform public.create_notification_internal(v_cast, '空き枠が追加されました', '空き枠が追加されました。空き枠一覧をご確認ください。', '/cast/vacant-slots');
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object('notified_count', v_notified, 'duplicate', false);
end;
$$;

revoke execute on function public.notify_vacant_slots() from public, anon;
grant execute on function public.notify_vacant_slots() to authenticated;

commit;

-- ロールバック用コメント（実行はしない。参考情報として記載）:
-- notify_vacant_slots を削除し、create_vacant_slot を本migration適用前の定義
-- （通知作成ループ・notified_countを含む版。20260919000000参照）へ戻せば、本migration適用前の
-- 挙動に戻せる。データの欠落は発生しない（本migrationは列やテーブルの追加・削除を伴わない、
-- 関数定義のみの変更のため）。
-- drop function if exists public.notify_vacant_slots();
