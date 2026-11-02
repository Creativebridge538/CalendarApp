-- check_shift_double_booking()のroom容量チェック（SELECT count(*)）に、room_id単位の
-- pg_advisory_xact_lockを追加する。これにより、shiftsをstatus='confirmed'にする全ての経路
-- （管理画面の直接確定・修正申請の承認/却下・空き枠申請の承認・確定済みシフトの部屋/日時変更。
-- カレンダー開発台帳130-b・132節に詳細）が、本トリガーを通じて同一room_idへの書き込みを
-- 一律に直列化するようになる。
--
-- Codex点検（2026-11-03、1回目）で、次のロック順序逆転によるデッドロックの可能性を指摘された:
-- review_vacant_slot_application・guard_linked_shift_statusは、承認時に
-- 「room単位のadvisory lock → 対象shift行の更新（行ロック）」の順で資源を取得していたが、
-- 管理画面の直接確定・確定済みシフトの部屋変更・修正申請の承認/却下は、いずれも対象shift行への
-- 単純なUPDATE文であり、PostgreSQLの通常動作により「対象行の行ロック（UPDATE文自体が暗黙に
-- 取得）→ BEFORE トリガー内でのroom単位ロック取得」の順になる。この2つの順序は逆であり、
-- 同一のshift行を対象に両方の経路が真に同時実行された場合、循環待機（デッドロック）が生じ得る。
--
-- 1回目の対応案（ロック削除）はCodex点検（2026-11-03、2回目）で却下された：
-- review_vacant_slot_application・guard_linked_shift_statusの自前のoverlap確認
-- （exists(...)。`status='confirmed'`の確定シフトとの重複を、**room容量の設定に関わらず
-- 常に禁止する**という、check_shift_double_bookingより厳格な別の不変条件）は、ロックによる
-- 直列化が無いと、room容量が2以上の場合に両方の同時承認がcheck_shift_double_booking側の
-- 判定（capacity以内）を通過してしまい、本来禁止すべき重複を防げなくなる回帰を生む。
--
-- 2回目の対応：ロックは削除せず維持し、**取得順序だけを揃える**。review_vacant_slot_applicationの
-- 承認処理（既存shiftをUPDATEする場合）で、room単位のロックを取得する前に、対象shift行自体を
-- 明示的に`for update`でロックする（新規shiftをINSERTする場合は競合する既存行が無いため対象外）。
-- これにより、既存行を更新する経路はすべて「対象shift行の行ロック→room単位ロック」という
-- 一貫した順序になり、順序逆転によるデッドロックの余地が無くなる。room単位のロックと、
-- その保護下でのoverlap確認（exists検査）は、いずれも元のまま維持する（厳格な不変条件を保つ）。
-- guard_linked_shift_statusは、自身が発火するBEFORE UPDATEトリガーの対象行（shift自身）の
-- 行ロックが、トリガー実行前にPostgreSQLによって既に取得済みであるため、対象shift行の行ロックは
-- 常にroom単位ロックの取得より先に成立しており、追加の変更は不要（そのため本migrationでは
-- guard_linked_shift_status自体には触れない。既存の定義のまま）。
--
-- 鍵の一致：`hashtextextended(room_id::text, 0)`は、削除前のreview_vacant_slot_application・
-- guard_linked_shift_statusが使っていた鍵と完全に同じ文字列・同じ第2引数（0）から計算される。
-- 同一トランザクション内でこのロックを複数回取得しても（PostgreSQLのadvisory lockは同一セッション
-- 内で再入可能なため）即座に成功し、デッドロックは生じない。異なるトランザクションからの取得が
-- 競合した場合は、先行する側のCOMMIT/ROLLBACKまで後続側がブロックされる
-- （`pg_advisory_xact_lock`はトランザクション終了時に自動解放されるため、明示的なUNLOCKは不要）。
--
-- 計算ロジック自体（capacity判定の数式・対象ステータス）は変更しない。
--
-- search_path・SECURITY属性・権限について：`hashtextextended`・`pg_advisory_xact_lock`は
-- いずれもPostgreSQL組み込み関数であり、スキーマ修飾無しで各関数のsearch_path設定に関わらず
-- 解決できる（`pg_catalog`は常にsearch_pathの暗黙の先頭に含まれるため）。SECURITY属性・所有者・
-- 既存の個別GRANT/REVOKEはいずれも変更しない。advisory lockの取得自体は、対象ロールに追加の
-- 権限を要求しない（PostgreSQL公式仕様：advisory lock関数はPUBLICに実行権限がある組み込み関数）。

create or replace function public.check_shift_double_booking()
returns trigger
language plpgsql
set search_path = public
as $$
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

  -- room単位のadvisory lock。既存のreview_vacant_slot_application・guard_linked_shift_statusが
  -- 使っていた鍵と同じ（上記コメント参照）。同一room_idへの同時書き込みを直列化する。
  perform pg_advisory_xact_lock(hashtextextended(NEW.room_id::text, 0));

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
    and shx.status in ('confirmed', 'modification_requested')
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
$$;

create or replace function public.review_vacant_slot_application(p_application_id uuid, p_next_status request_status)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_notified       integer := 0;
  v_title          text;
  v_body           text;
  v_slot_id        uuid;
  v_slot           public.vacant_slots%rowtype;
  v_app            public.vacant_slot_applications%rowtype;
  v_shift_id       uuid;
  v_approved_count integer;
  v_start          time;
  v_end            time;
  v_date           date;
  v_new_start      timestamp;
  v_new_end        timestamp;
  v_rows           integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  perform set_config('app.vsa_managed', 'on', true);

  select vacant_slot_id into v_slot_id
  from public.vacant_slot_applications where id = p_application_id;
  if not found then
    raise exception '対象の申請が見つかりません' using errcode = 'P0002';
  end if;

  -- 申請・非公開化・削除と同じ空き枠単位のロックを、空き枠の行ロックより前に取得する
  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || v_slot_id::text, 0));

  -- 自店舗の空き枠のみ対象（他店舗は見つからない扱いにして存在を漏らさない）
  select * into v_slot
  from public.vacant_slots
  where id = v_slot_id and store_id = public.my_store_id()
  for update;
  if not found then
    raise exception '対象の申請が見つかりません' using errcode = 'P0002';
  end if;

  select * into v_app
  from public.vacant_slot_applications
  where id = p_application_id and vacant_slot_id = v_slot.id
  for update;
  if not found then
    raise exception '対象の申請が見つかりません' using errcode = 'P0002';
  end if;

  -- 既に同じ状態なら何もしない（二重クリック・再送に対して冪等）
  if v_app.status = p_next_status then
    return to_jsonb(v_app) || jsonb_build_object('notified_count', 0);
  end if;

  if not (
       (v_app.status = 'pending'  and p_next_status in ('approved', 'rejected'))
    or (v_app.status = 'approved' and p_next_status in ('pending', 'rejected'))
    or (v_app.status = 'rejected' and p_next_status = 'approved')
  ) then
    raise exception 'この状態からは変更できません' using errcode = '22023';
  end if;

  -- 実効の時間帯（希望時刻。null/nullなら公開枠全体）。承認時のshift内容と、通知の文面で使う
  if v_app.requested_start_time is not null and v_app.requested_end_time is not null then
    v_start := v_app.requested_start_time;
    v_end   := v_app.requested_end_time;
  else
    v_start := v_slot.start_time;
    v_end   := v_slot.end_time;
  end if;

  if p_next_status = 'approved' then
    select count(*) into v_approved_count
    from public.vacant_slot_applications
    where vacant_slot_id = v_slot.id and status = 'approved' and id <> v_app.id;
    if v_approved_count >= v_slot.capacity then
      raise exception '募集人数（%人）に達しています', v_slot.capacity using errcode = '23514';
    end if;

    v_date := public.vacant_slot_effective_date(v_slot.date, v_slot.start_time,
                case when v_app.requested_start_time is not null and v_app.requested_end_time is not null
                     then v_app.requested_start_time end);

    -- 2026-11-03修正：対象shiftが既存行（UPDATE）の場合、room単位ロックより先にその行自体を
    -- 明示的にロックする（管理画面の直接確定・修正申請の承認/却下と同じ「行ロック→room lock」の
    -- 順序に揃え、ロック順序逆転によるデッドロックを避ける）。新規行（INSERT）の場合は競合する
    -- 既存行が無いため対象外。
    if v_app.shift_id is not null then
      perform 1 from public.shifts where id = v_app.shift_id for update;
    end if;

    -- 空き枠の承認は、店舗設定やルーム定員に関わらず同じルームの確定シフトとの重複を常に禁止する
    -- （room単位のロックで直列化した上で判定する。既存の厳格な不変条件を維持）
    if v_slot.room_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_slot.room_id::text, 0));
      v_new_start := (v_date + v_start)::timestamp;
      v_new_end   := (v_date + v_end + (case when v_end <= v_start then interval '1 day' else interval '0' end))::timestamp;
      if exists (
        select 1 from public.shifts sh
        where sh.store_id = v_slot.store_id
          and sh.room_id = v_slot.room_id
          and sh.status = 'confirmed'
          and (v_app.shift_id is null or sh.id <> v_app.shift_id)
          and tsrange(
                (sh.date + sh.start_time)::timestamp,
                (sh.date + sh.end_time + (case when sh.end_time <= sh.start_time then interval '1 day' else interval '0' end))::timestamp,
                '[)'
              ) && tsrange(v_new_start, v_new_end, '[)')
      ) then
        raise exception 'shifts_no_double_booking: overlapping confirmed shift in the same room'
          using errcode = '23P01';
      end if;
    end if;

    if v_app.shift_id is not null then
      -- 申請時に作成済みの仮予定（提出済み）を確定へ切り替える。その際、内容を空き枠と希望時刻から算出した
      -- 正しい値へ明示的に矯正する（cast_id・store_idは矯正せず、一致しなければ見つからない扱いで例外）
      update public.shifts
      set status = 'confirmed',
          room_id = v_slot.room_id, area_id = v_slot.area_id,
          date = v_date, start_time = v_start, end_time = v_end
      where id = v_app.shift_id and cast_id = v_app.cast_id and store_id = v_slot.store_id
      returning id into v_shift_id;
      if v_shift_id is null then
        raise exception '紐づくシフトが見つかりません' using errcode = 'P0002';
      end if;
    else
      insert into public.shifts (cast_id, store_id, room_id, area_id, date, start_time, end_time, status)
      values (v_app.cast_id, v_slot.store_id, v_slot.room_id, v_slot.area_id, v_date, v_start, v_end, 'confirmed')
      returning id into v_shift_id;
    end if;

    -- 新規作成したshiftのIDも含め、必ず申請へ保存する
    update public.vacant_slot_applications
    set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), shift_id = v_shift_id
    where id = v_app.id
    returning * into v_app;

    v_title := '空き枠申請が承認されました';

  elsif p_next_status = 'rejected' then
    v_shift_id := v_app.shift_id;
    update public.vacant_slot_applications
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), shift_id = null
    where id = v_app.id
    returning * into v_app;

    if v_shift_id is not null then
      delete from public.shifts
      where id = v_shift_id and cast_id = v_app.cast_id and store_id = v_slot.store_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception '紐づくシフトを削除できませんでした' using errcode = 'P0002';
      end if;
    end if;

    v_title := '空き枠申請が不承認になりました';

  else
    -- 承認取消（approved → pending）: キャストが再提出したのと同じ「提出済み」の状態に戻す
    if v_app.shift_id is not null then
      update public.shifts
      set status = 'submitted'
      where id = v_app.shift_id and cast_id = v_app.cast_id and store_id = v_slot.store_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception '紐づくシフトを更新できませんでした' using errcode = 'P0002';
      end if;
    end if;

    update public.vacant_slot_applications
    set status = 'pending', reviewed_at = null, reviewed_by = null
    where id = v_app.id
    returning * into v_app;
  end if;

  -- 承認・不承認: 申請者へのアプリ内通知を同じトランザクションで作成する（承認取消では通知しない）
  if v_title is not null then
    v_body := public.vacant_slot_format_date(v_slot.date) || ' ' || public.vacant_slot_format_range(v_slot.start_time, v_start, v_end) || ' の空き枠';
    perform public.create_notification_internal(v_app.cast_id, v_title, v_body, '/cast/vacant-slots');
    v_notified := 1;
  end if;

  return to_jsonb(v_app) || jsonb_build_object('notified_count', v_notified);
end;
$$;
