-- 空き枠申請で、公開枠(vacant_slots)の一部時間帯だけを希望できるようにする。
-- 既存申請はrequested_start_time/requested_end_timeがnull/nullのまま残り、
-- 「公開枠全体を希望したもの」として扱う（後方互換）。
--
-- 【ファイル名と実際の内容について】 ファイル名は「空き枠申請の希望時間帯」機能だが、レビューで見つかった
-- 以下の修正も同じ1ファイルにまとめて含む（分割はしていない。分割設計は別途レビュー済み・未実施）:
--   ・notifications の直接書き込み権限の全面ロックダウン（anon/authenticatedへの広すぎる権限の剥奪）
--   ・シフト修正申請(shift_modification_requests)機能そのものの全面書き直し
--   ・shifts の状態変更・削除に対する横断的なガードトリガー
--   ・テスト通知・シフト提出リマインドRPC
--   ・Web Push配信(claim_pending_push_notifications)のレート制限
-- 空き枠機能だけを個別に有効化・無効化・ロールバックすることはできない（全体が1つの適用単位）。
--
-- 【適用方式についての注記】 以前は「適用は1ファイル=1トランザクション」という前提を記載していたが、
-- Supabase CLI（apps/cli-go/pkg/migration/apply.go の ApplyMigrations・file.go の ExecBatch、2026-10時点の
-- supabase/cli mainブランチを確認）は、migrationファイルの適用時に明示的な BEGIN/COMMIT でファイル全体を
-- 1トランザクションとして囲ってはいない（CREATE INDEX CONCURRENTLY 等パイプライン非対応の文だけを個別実行し、
-- それ以外はpgconn.Batchでパイプライン送信するのみで、トランザクション境界を管理するコードは見当たらなかった）。
-- そのため、CLIの既定動作だけに任せず、本ファイル自身が明示的な BEGIN;〜COMMIT; で全体を1トランザクションとして
-- 囲っている（本ファイル冒頭のBEGIN;・末尾のCOMMIT;）。囲む前に、本ファイル全体にトランザクションブロック内で
-- 実行できない文（CREATE/DROP INDEX CONCURRENTLY・REINDEX CONCURRENTLY・VACUUM・ALTER SYSTEM・
-- CREATE/DROP DATABASE・CREATE TABLESPACE・CLUSTER・ALTER TYPE ... ADD VALUE等）が無いことを確認済み
-- （PostgreSQL 17公式ドキュメントのCREATE INDEX該当ページ、およびsupabase/cliのisPipelineIncompatible判定
-- ロジックが対象とする文の一覧を根拠にした）。あわせて、DDL変更を一切行う前に全ての前提条件（既存オブジェクトの
-- 存在・重複データの有無）を検査するPREFLIGHTブロックを本ファイル冒頭（BEGIN;の直後）に置き、検査に失敗した
-- 場合はトランザクション全体がロールバックされ、DBには一切変更が残らないようにしている。
--
-- あわせて、レビューで見つかった以下を同じmigration内で解消する。
--  (a) vacant_slot_applications の cast 向け RLS が FOR ALL で、自分の申請の status /
--      shift_id / vacant_slot_id / 希望時刻を直接APIで書き換えられた → 用途別に分割
--  (b) 承認・却下・承認取消・再公開・申請・取消が「申請」「shift」を別々のクエリで更新しており、
--      途中失敗で不整合が残った → SECURITY INVOKER のRPC（単一トランザクション）へ集約
--  (c) 申請に「申請内容と無関係な自分のshift」を紐づけて承認させ、無関係なshiftを確定させられた
--      → 申請INSERT/shift_id変更時にshiftの内容を検証し、承認時にも再検証・矯正する
--  (d) 申請を直接DELETEしても仮shiftが残った → DELETEトリガーで同一トランザクション内で削除
--  (e) 再公開時にshift復元が一部失敗すると「approvedなのにshiftなし・公開中」が残った
--      → 復元に1件でも失敗したらRPC全体（公開状態を含む）をロールバック
--  (f) 申請と非公開化が同時に走ると「非公開枠に申請とshiftだけが作られる」 → 空き枠単位のロック
--  (g) 空き枠作成時のアプリ内通知が、空き枠の作成とは別のクエリで、エラーも確認されずに登録されていた
--      → 空き枠の作成と通知の登録を1つのRPCで同一トランザクションにする（Web Pushは外部処理のため別扱い）
--  (h) キャストの画面が自分の申請の状態変化（承認・取消・却下）をリアルタイムに受け取れなかった
--      → vacant_slot_applications をSupabase Realtimeの配信対象にする
--  (i) キャストの申請時に管理者へ通知するため、キャストのブラウザからusersを検索していたが、
--      RLSによりキャストは自分自身の行しか読めず管理者が0件になり、通知が飛ばなかった
--      → apply_vacant_slot が、申請・shift作成・同店舗管理者へのアプリ内通知を同一トランザクションで行う
--  (j) 承認・不承認後のキャストへの通知が、RPCとは別のクエリでエラーも確認されずに登録されていた
--      → review_vacant_slot_application が、承認/不承認処理とキャストへのアプリ内通知を同一トランザクションで行う
--  (k) トリガー内のexists確認だけでは、同時INSERTで1つのshiftを複数の申請へ紐づけられる
--      → vacant_slot_applications(shift_id) に一意インデックス（既存データに重複があればmigrationを停止）
--  (l) 承認RPCも申請・非公開化・削除と同じ空き枠単位のアドバイザリロックを（空き枠の行ロックより前に）取得する
--  (m) 空き枠申請に紐づくshiftの状態変更（確定・確定取消・差し戻し・削除）が、承認RPCを迂回して行えた
--      → 旧自動承認トリガー(sync_vacant_slot_application_on_shift_confirm)を廃止し、shifts上のガードトリガーで
--        どの画面・API経路でも承認上限・ロック・reviewed_by・通知・申請との同一トランザクション処理を通す
--  (n) 申請(vacant_slot_applications)を全ロールから直接INSERT/UPDATE/DELETEできた
--      → RLS・GRANTの両方で閉じ、変更は下記の管理されたRPC（とshiftsガードトリガー）だけに一本化
--  (o) notificationsへ任意の宛先・title・body・linkを直接INSERTでき、anonにも全権限があった
--      → INSERTポリシー削除・GRANT剥奪（authenticatedは自分の通知のread_at更新のみ）。通知はDB内の用途別経路
--        （RPC・トリガー）だけが作成し、宛先・文面・リンクはDB側で決める（リンクはアプリ内の許可パスのみ）
--  (p) キャストのブラウザが管理者のuuidを得ていた／通知INSERTがブラウザから行われていた
--      → 管理者uuidをブラウザへ返さない。Web Pushは「呼び出し元が作成した未送信の通知」だけを送るAPIへ置き換え
--  (q) sync_vacant_slot_approved_count(uuid) がPUBLIC/anonから直接実行できた → EXECUTEを剥奪
--  (r) 既存の check_shift_double_booking() が search_path 未指定のため、管理RPC(search_path='')内でルーム付きshiftを
--      confirmedにすると失敗する → 関数本体は変えず search_path=public を固定（実ブラウザ確認で発見）
--
-- 以下は、v5レビューで「main反映を止める問題」として指摘され、同じmigration内で解消するもの:
--  (s) 修正申請の作成が、shiftのstatus変更とshift_modification_requestsへのINSERTを別々のクエリ(Promise.all)で
--      行っており、片方だけ成功する・通知だけ失敗するなどの不整合が起こり得た
--      → create_shift_modification_request RPCへ一本化（同一トランザクション。既にpendingの申請がある
--        shiftへの重複申請も拒否）
--  (t) shift_modification_requests を cast が直接INSERT/UPDATE/DELETEでき、管理者も直接UPDATEで
--      review_shift_modification_request を迂回できた → vacant_slot_applications と同じ方針でRLS・GRANTを閉じ、
--      作成・承認・却下・承認してキャンセルは上記RPCと review_shift_modification_request だけに一本化。
--      同じshiftへの複数pending申請も一意インデックスで防止（既存データに重複があればmigrationを停止）
--  (u) review_shift_modification_request が、申請者=shiftの本人か・shiftが修正依頼中かを明示確認していなかった
--      → 追加のチェックを入れ、他人・他店舗・非confirmed/非modification_requestedのshiftへの処理を拒否
--  (v) /api/push/dispatch が一部のDB取得エラーを確認せず、取得失敗を「対象0件・成功」として返しうる箇所があった
--      → 各クエリのerrorを確認し、失敗時は成功として扱わない。確保(push_sent_at設定)後・送信試行前に失敗した
--        通知は確保を解除し、次回の呼び出しで再試行できるようにする（アプリ側コードのみの修正。migration変更なし）
--
-- 以下は、v6レビューで指摘され、同じmigration内で解消するもの:
--  (w) shiftsの既存ポリシー「shifts: cast が確定シフトに修正申請」（20260819080000）が残っており、
--      キャストがcreate_shift_modification_requestを迂回してshifts.statusをconfirmed→modification_requestedへ
--      直接UPDATEでき、「shiftはmodification_requestedだが申請が無い・管理者通知も無い」不整合を作れた。
--      また管理者の既存の全操作ポリシーにより、pendingの修正申請があるshiftを直接confirmed/rejected/submitted等へ
--      変更・削除すると「申請はpendingのまま・shiftだけ変わる／消える」不整合も作れた
--      → 上記ポリシーを削除し、pendingのshift_modification_requestsが紐づくshiftの直接status変更・削除を
--        拒否する新しいガードトリガー（guard_linked_modification_request_status/delete）を追加。管理されたRPC
--        （create_shift_modification_request・review_shift_modification_request）は app.smr_managed='on' で
--        このガードを通さない
--  (x) review_shift_modification_request の承認(approve)で、開始=終了の時刻を指定できてしまう
--      → create_vacant_slot と同じ規則で、開始=終了は入力ミス扱いとして拒否する（24時間勤務の表現には使わない。
--        既存の深夜シフト表記との整合はアプリ側コード側の対応。migration側の変更点はこの検証のみ）
--  (y) /api/push/dispatch の「直近1分の送信件数確認」と「未送信通知のclaim」が別クエリのため、同時に複数
--      リクエストが来ると、両方が古い件数を見て別々の通知をclaimし、MAX_PUSH_PER_MINUTEを超える可能性があった
--      → claim_pending_push_notifications RPC（呼び出し元単位のアドバイザリロックで直列化。上限確認とclaimを
--        1つのトランザクションで行う）に置き換える
--
-- 以下は、v7レビューで指摘され、同じmigration内で解消するもの:
--  (z) claim_pending_push_notifications が authenticated にEXECUTEされており、ブラウザから直接RPCを呼んで
--      ①上限値(p_max_per_minute等)を大きく指定して連続送信抑止を無効化する、②returns setof public.notifications
--      が通知行全体（宛先user_id含む）を返すため、それを取得する、ことができた。また残量計算が
--      「v_recentが上限未満ならp_max_batchをそのまま確保」だったため、確保件数の合計が上限を超えることがあった
--      （例: v_recent=150, p_max_per_minute=200, p_max_batch=100 で250件確保できた）
--      → PUBLIC/anon/authenticatedからEXECUTEを剥奪しservice_roleだけが実行できるようにする。呼び出し元の
--        識別はauth.uid()ではなく明示引数p_user_idで行い、/api/push/dispatchは通常クライアントで認証した
--        ユーザーのIDをadmin client(service_role)経由でこのRPCへ渡す。確保件数は
--        least(p_max_batch, p_max_per_minute - v_recent) に修正し、残量が0以下なら拒否する。上限値の引数は
--        DB側の固定上限(v_hard_*)でクランプし、渡された値がそれを超えても無視する
--
-- SECURITY DEFINER について（このmigrationで追加するもの・すべて set search_path = '' と完全修飾名。EXECUTEは
-- PUBLIC/anonをrevoke。RPCは原則authenticatedにのみgrant、内部関数・トリガー関数はEXECUTEを誰にも与えない。
-- claim_pending_push_notifications だけは例外でauthenticatedにもgrantせず、service_role専用）:
--   空き枠RPC 6本 … 申請・shiftの直接DMLと通知の直接INSERTを閉じたため、これらの関数（所有者権限）だけが実行できる。
--                    RLSに頼れなくなるため、認可（ロール・自店舗・所有者）は各関数内で明示的に検査する。
--   shifts/申請のガードトリガー … 一般ユーザー（cast等）の権限では申請テーブルを更新・削除できないため。
--   通知トリガー・修正申請RPC・リマインド/テスト通知RPC … 通知の直接INSERTを閉じたため。
--   create_shift_modification_request … shift_modification_requestsの直接DMLを閉じたため。
--   claim_pending_push_notifications … notificationsのpush_sent_at更新（authenticatedにはSELECTとread_at列の
--                                       UPDATEしか許可していない）を上限確認と同一トランザクションで行うため。
--                                       任意のuser_idを引数に取り、通知行（宛先user_id等）を返すため、
--                                       authenticatedにもgrantせずservice_role専用にする（v8）。
-- 上記以外の追加関数・補助関数は SECURITY INVOKER。

-- 本ファイル全体を単一トランザクションとして囲む（末尾のCOMMIT;と対）。ここから先で例外が発生した場合は
-- 自動的にロールバックされ、DBには一切変更が残らない。
begin;

-- ============================================================================
-- PREFLIGHT: 本migrationが前提とする既存オブジェクトの検査と、既存データの重複チェック。
-- ============================================================================
-- 目的: 本migrationはRayzy DEVでのみ動作確認しており、HIMECA・ShiftMate等スキーマ履歴が分岐している
-- 可能性のある環境へ最初に適用する際、不足しているオブジェクトを名指しした分かりやすい例外で早期に
-- 停止させるため（BEGIN/COMMITによる全体のロールバック自体は上記で既に保証されているが、Postgresの
-- デフォルトのエラー（例: "column does not exist"）は、ファイルのどの前提が崩れているのかを直接示さない
-- ことがある。PREFLIGHTは診断のわかりやすさのための追加の防御線であり、DDL変更を一切行う前に、
-- 以下をすべてこのブロックで検査する:
--   ・本migrationが ALTER / CREATE OR REPLACE / ALTER POLICY などで前提とする既存テーブル・関数・型・
--     ポリシーが実際に存在するか
--   ・重複データがあると一意インデックス作成が失敗する箇所（vacant_slot_applications.shift_id /
--     shift_modification_requests の pending shift_id）に、実際に重複がないか
-- 不足・重複が見つかった場合は、どのオブジェクトが不足しているか分かる例外を出し、後続のDDLには一切進まない。
-- 環境固有の値（Project Ref・Secret等）はここでは一切参照・出力しない。
do $$
declare
  v_missing text[] := '{}';
begin
  -- テーブル
  if to_regclass('public.notifications') is null then v_missing := v_missing || 'table: public.notifications'; end if;
  if to_regclass('public.vacant_slots') is null then v_missing := v_missing || 'table: public.vacant_slots'; end if;
  if to_regclass('public.vacant_slot_applications') is null then v_missing := v_missing || 'table: public.vacant_slot_applications'; end if;
  if to_regclass('public.shifts') is null then v_missing := v_missing || 'table: public.shifts'; end if;
  if to_regclass('public.shift_modification_requests') is null then v_missing := v_missing || 'table: public.shift_modification_requests'; end if;
  if to_regclass('public.users') is null then v_missing := v_missing || 'table: public.users'; end if;
  if to_regclass('public.areas') is null then v_missing := v_missing || 'table: public.areas'; end if;
  if to_regclass('public.rooms') is null then v_missing := v_missing || 'table: public.rooms'; end if;

  -- 関数（本migrationが直接ALTER/REVOKEする既存関数、および全RPCが権限判定に使うヘルパー関数）
  if to_regprocedure('public.check_shift_double_booking()') is null then v_missing := v_missing || 'function: public.check_shift_double_booking()'; end if;
  if to_regprocedure('public.sync_vacant_slot_approved_count(uuid)') is null then v_missing := v_missing || 'function: public.sync_vacant_slot_approved_count(uuid)'; end if;
  if to_regprocedure('public.my_role()') is null then v_missing := v_missing || 'function: public.my_role()（全RPC/トリガーの権限判定が依存）'; end if;
  if to_regprocedure('public.my_store_id()') is null then v_missing := v_missing || 'function: public.my_store_id()（全RPC/トリガーの権限判定が依存）'; end if;

  -- 列挙型（RPCの引数型・キャストで使用）
  if to_regtype('public.request_status') is null then v_missing := v_missing || 'type: public.request_status'; end if;
  if to_regtype('public.shift_status') is null then v_missing := v_missing || 'type: public.shift_status'; end if;

  -- ALTER POLICY対象となる、notifications の既存ポリシー3件（元定義は20260526142207_initial_schema.sql・
  -- 20260816070000_admin_read_store_notifications.sqlで確認済み。USING句は変更せず対象ロールとWITH CHECKのみ変更する）
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notif: 自分の通知を参照') then
    v_missing := v_missing || 'policy: public.notifications / "notif: 自分の通知を参照"';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notif: admin が同店舗ユーザー宛の通知を参照') then
    v_missing := v_missing || 'policy: public.notifications / "notif: admin が同店舗ユーザー宛の通知を参照"';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notif: 自分の通知を更新（既読）') then
    v_missing := v_missing || 'policy: public.notifications / "notif: 自分の通知を更新（既読）"';
  end if;

  -- RPC・トリガーが参照する既存列のうち、環境間のスキーマ差で欠けやすく、かつ欠けていても
  -- CREATE OR REPLACE FUNCTION時点ではエラーにならず実行時まで気付けないもの（網羅的な全列検査ではない）
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='vacant_slots' and column_name='created_by') then
    v_missing := v_missing || 'column: public.vacant_slots.created_by'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='vacant_slots' and column_name='capacity') then
    v_missing := v_missing || 'column: public.vacant_slots.capacity'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='vacant_slots' and column_name='is_published') then
    v_missing := v_missing || 'column: public.vacant_slots.is_published'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shifts' and column_name='confirmed_at') then
    v_missing := v_missing || 'column: public.shifts.confirmed_at'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='is_active') then
    v_missing := v_missing || 'column: public.users.is_active'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='display_name') then
    v_missing := v_missing || 'column: public.users.display_name'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'このmigrationが前提とする既存オブジェクトが不足しています（DBへの変更は一切行っていません）。不足: %', array_to_string(v_missing, ' / ')
      using errcode = '55000';
  end if;
end
$$;

-- 重複チェック1/2: vacant_slot_applications.shift_id（後段で一意インデックスを作成する対象。検査のみ
-- ここで行い、実際のCREATE UNIQUE INDEXは元の位置（本ファイル後方の該当セクション）で行う）
do $$
declare
  v_dups integer;
  v_sample text;
begin
  select count(*), string_agg(shift_id::text, ', ' order by shift_id)
    into v_dups, v_sample
  from (
    select shift_id from public.vacant_slot_applications
    where shift_id is not null
    group by shift_id having count(*) > 1
    order by shift_id limit 5
  ) d;
  if v_dups > 0 then
    raise exception 'vacant_slot_applications.shift_id に重複があるため、一意インデックスを作成できません（重複するshift_idの例: %）。データを確認し、手動で解消してから再実行してください', v_sample
      using errcode = '23505';
  end if;
end
$$;

-- 重複チェック2/2: shift_modification_requests の pending shift_id（同上。実際のCREATE UNIQUE INDEXは
-- 元の位置で行う）
do $$
declare
  v_dups integer;
  v_sample text;
begin
  select count(*), string_agg(shift_id::text, ', ' order by shift_id)
    into v_dups, v_sample
  from (
    select shift_id from public.shift_modification_requests
    where status = 'pending'
    group by shift_id having count(*) > 1
    order by shift_id limit 5
  ) d;
  if v_dups > 0 then
    raise exception 'shift_modification_requests に同じshiftへのpending申請の重複があるため、一意インデックスを作成できません（重複するshift_idの例: %）。データを確認し、手動で解消してから再実行してください', v_sample
      using errcode = '23505';
  end if;
end
$$;

alter table public.vacant_slot_applications
  add column requested_start_time time,
  add column requested_end_time   time;

-- ---------------------------------------------------------------------------
-- 共通ヘルパー（SECURITY INVOKER / immutable）
-- ---------------------------------------------------------------------------

-- 空き枠の実際の終了日時（日本時間の壁時計基準のtimestamp）。
-- 終了時刻 < 開始時刻 は日またぎ枠として翌日の終了時刻を返す。
-- 開始=終了は日をまたがせず（=24時間枠として扱わず）空き枠の日付のままとする。
-- クライアント側 src/lib/vacant-slot-request-time.ts の vacantSlotEndKey と同じ規則。
create or replace function public.vacant_slot_ends_at(p_date date, p_start_time time, p_end_time time)
returns timestamp
language sql
immutable
set search_path = public
as $$
  select (p_date + p_end_time) + case when p_end_time < p_start_time then interval '1 day' else interval '0' end
$$;

-- 申請から作るshiftの実効日付。希望開始が公開枠の開始時刻より前（=日をまたいだ翌日側）なら
-- 空き枠の日付の翌日、それ以外（希望なし=null含む）は空き枠の日付のまま。
-- クライアント側 resolveEffectiveShiftTime と同じ規則。
create or replace function public.vacant_slot_effective_date(p_slot_date date, p_slot_start_time time, p_requested_start_time time)
returns date
language sql
immutable
set search_path = public
as $$
  select case when p_requested_start_time is not null and p_requested_start_time < p_slot_start_time
              then p_slot_date + 1 else p_slot_date end
$$;

-- 通知文面の整形（クライアントの date-fns 'M/d(E)' ja / formatTimeRange と同じ書式）。
-- 例: 9/28(月) / 22:00〜翌05:00（anchorより前の時刻は翌日側として「翌」を付ける）
create or replace function public.vacant_slot_format_date(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char(p_date, 'FMMM/FMDD') || '(' || (array['日','月','火','水','木','金','土'])[extract(dow from p_date)::int + 1] || ')'
$$;

create or replace function public.vacant_slot_format_range(p_anchor_start time, p_start time, p_end time)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_start < p_anchor_start then '翌' else '' end || to_char(p_start, 'HH24:MI')
      || '〜'
      || case when p_end < p_anchor_start then '翌' else '' end || to_char(p_end, 'HH24:MI')
$$;

-- 上記4本のヘルパー関数はテーブルを一切参照しない純粋な日時/文字列整形関数で、他のSECURITY DEFINER関数の
-- 内部から呼ばれる想定のみ（呼び出し元がSECURITY DEFINERであれば、その所有者権限でこれらも実行されるため、
-- 以下のEXECUTE剥奪があっても内部からの呼び出しは妨げられない）。デフォルト権限（default privileges）任せに
-- せず、PUBLIC・anon・authenticatedへのEXECUTEを明示的に剥奪する。
revoke execute on function public.vacant_slot_ends_at(date, time, time) from public, anon, authenticated;
revoke execute on function public.vacant_slot_effective_date(date, time, time) from public, anon, authenticated;
revoke execute on function public.vacant_slot_format_date(date) from public, anon, authenticated;
revoke execute on function public.vacant_slot_format_range(time, time, time) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1つのshiftを複数の申請へ紐づけられないようにする一意インデックス
-- ---------------------------------------------------------------------------
-- 検証トリガー内のexists確認だけでは、同時INSERTで同じshift_idを複数の申請へ紐づけられる可能性がある。
-- shift_id is not null の行だけを対象にDBの一意インデックスで最終防衛する。
-- 重複データの有無は、本ファイル冒頭のPREFLIGHTブロックで先に検査済み（このCREATE UNIQUE INDEXより前に
-- 重複があれば例外で停止している。ここでは重複が無いことを前提にインデックスを作成するだけ）。
create unique index uq_vacant_slot_applications_shift_id
  on public.vacant_slot_applications (shift_id)
  where shift_id is not null;

-- ---------------------------------------------------------------------------
-- 申請の検証トリガー（希望時刻・紐づくshiftの内容・終了済み・空き枠の公開状態）
-- ---------------------------------------------------------------------------
-- INSERT、および 参照先空き枠(vacant_slot_id)・希望時刻・紐づくshift(shift_id)が変わるUPDATEで
-- 必ず再検証する。SECURITY INVOKER（security definer句を付けない）。
-- 参照先vacant_slotsの可視性は既存の「vacant_slots: cast が公開分を参照」
-- 「vacant_slots: admin が全操作」RLSに委ねる。申請者からRLS越しに見えない
-- （≒非公開/他店舗）空き枠は下のSELECTが0件になり拒否される。
--
-- ・希望時刻: 分単位の連続したタイムライン（公開枠の開始時刻を基準=0分）へ正規化して判定する。
--   公開枠・希望時間ともに日またぎ（終了 < 開始）を1回だけ許容する（クライアント側の
--   isValidRequestedRangeと同じ計算式）。公開枠自体が開始=終了の場合はspanが0になり、
--   いかなる希望時間も範囲外として拒否される（24時間枠としては扱わない）。
--   time型は '24:00' を受け付けてしまうため、希望時刻の24:00以上は明示的に拒否する
--   （25:00以上は型変換の段階でDBが拒否する）。
-- ・紐づくshift: shift_idを指定する場合、そのshiftが申請内容（空き枠と希望時刻から算出した
--   cast_id・store_id・room_id・area_id・date・start_time・end_time）と一致しなければ拒否する。
--   これにより「空き枠と無関係な自分のshift」を紐づけて承認させることを防ぐ。
--   INSERT時は提出済み(submitted)のshiftのみ紐づけ可能で、1つのshiftを複数の申請に紐づけられない。
-- ・新規申請（INSERT）は、空き枠が実際の終了日時（日本時間）を過ぎていれば拒否する。
--   日またぎ枠は翌日の終了時刻まで申請できる。
-- ・INSERTでは空き枠単位のアドバイザリロックを取ってから空き枠を読み直す。非公開化
--   (set_vacant_slot_published)が同じロックを取るため、申請と非公開化が同時に走っても
--   「非公開になった枠に申請だけが作られる」ことはない。
create or replace function public.check_vacant_slot_application_requested_time()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  slot_store uuid;
  slot_room  uuid;
  slot_area  uuid;
  slot_date  date;
  slot_start time;
  slot_end   time;
  slot_start_min   integer;
  slot_end_min     integer;
  slot_span_min    integer;
  req_start_min    integer;
  req_end_min      integer;
  req_start_offset integer;
  req_end_offset   integer;
  v_start    time;
  v_end      time;
  v_date     date;
  v_shift    public.shifts%rowtype;
begin
  -- 紐づくshiftが削除された際のFK(on delete set null)による shift_id の解除だけ（他の列は不変）は検証不要
  if tg_op = 'UPDATE'
     and new.shift_id is null and old.shift_id is not null
     and new.vacant_slot_id is not distinct from old.vacant_slot_id
     and new.requested_start_time is not distinct from old.requested_start_time
     and new.requested_end_time is not distinct from old.requested_end_time then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || new.vacant_slot_id::text, 0));
  end if;

  select store_id, room_id, area_id, date, start_time, end_time
    into slot_store, slot_room, slot_area, slot_date, slot_start, slot_end
  from public.vacant_slots
  where id = new.vacant_slot_id;

  if not found then
    raise exception '対象の空き枠を参照できません' using errcode = '23503';
  end if;

  if tg_op = 'INSERT'
     and public.vacant_slot_ends_at(slot_date, slot_start, slot_end) <= timezone('Asia/Tokyo', now()) then
    raise exception 'この空き枠は終了しています' using errcode = '23514';
  end if;

  if new.requested_start_time is null and new.requested_end_time is null then
    -- 両方nullは「公開枠全体を希望」として許可する（後方互換）
    v_start := slot_start;
    v_end   := slot_end;
    v_date  := slot_date;
  else
    if new.requested_start_time is null or new.requested_end_time is null then
      raise exception '開始時刻と終了時刻は両方指定してください' using errcode = '23514';
    end if;

    if extract(hour from new.requested_start_time) >= 24 or extract(hour from new.requested_end_time) >= 24 then
      raise exception '希望時刻は00:00〜23:59の範囲で指定してください' using errcode = '23514';
    end if;

    slot_start_min := extract(hour from slot_start)::int * 60 + extract(minute from slot_start)::int;
    slot_end_min   := extract(hour from slot_end)::int   * 60 + extract(minute from slot_end)::int;
    slot_span_min  := case when slot_end_min >= slot_start_min then slot_end_min - slot_start_min
                           else slot_end_min - slot_start_min + 1440 end;

    req_start_min := extract(hour from new.requested_start_time)::int * 60 + extract(minute from new.requested_start_time)::int;
    req_end_min   := extract(hour from new.requested_end_time)::int   * 60 + extract(minute from new.requested_end_time)::int;

    req_start_offset := case when req_start_min >= slot_start_min then req_start_min - slot_start_min
                              else req_start_min - slot_start_min + 1440 end;
    req_end_offset   := case when req_end_min >= slot_start_min then req_end_min - slot_start_min
                              else req_end_min - slot_start_min + 1440 end;

    if req_start_offset >= req_end_offset or req_end_offset > slot_span_min then
      raise exception '公開されている時間の範囲内で、開始時刻より後の終了時刻を指定してください' using errcode = '23514';
    end if;

    v_start := new.requested_start_time;
    v_end   := new.requested_end_time;
    v_date  := public.vacant_slot_effective_date(slot_date, slot_start, new.requested_start_time);
  end if;

  if new.shift_id is not null then
    select * into v_shift from public.shifts where id = new.shift_id;
    if not found then
      raise exception '紐づくシフトを参照できません' using errcode = '23503';
    end if;

    if v_shift.cast_id    is distinct from new.cast_id
       or v_shift.store_id   is distinct from slot_store
       or v_shift.room_id    is distinct from slot_room
       or v_shift.area_id    is distinct from slot_area
       or v_shift.date       is distinct from v_date
       or v_shift.start_time is distinct from v_start
       or v_shift.end_time   is distinct from v_end then
      raise exception '紐づくシフトの内容が申請内容（空き枠・希望時刻）と一致しません' using errcode = '23514';
    end if;

    if tg_op = 'INSERT' and v_shift.status <> 'submitted' then
      raise exception '申請に紐づけられるのは提出済みのシフトのみです' using errcode = '23514';
    end if;

    if exists (select 1 from public.vacant_slot_applications a where a.shift_id = new.shift_id and a.id <> new.id) then
      raise exception 'このシフトは既に別の申請に紐づいています' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

-- 参照先空き枠(vacant_slot_id)・希望時刻・紐づくshift(shift_id)を変更した場合も必ず再検証する
drop trigger if exists trg_check_vacant_slot_application_requested_time on public.vacant_slot_applications;
create trigger trg_check_vacant_slot_application_requested_time
  before insert or update of vacant_slot_id, requested_start_time, requested_end_time, shift_id on public.vacant_slot_applications
  for each row
  execute function public.check_vacant_slot_application_requested_time();

-- returns triggerの関数はトリガー発火時にしか呼べず（トリガーコンテキスト外で直接呼ぶとPostgreSQLがエラーにする）、
-- 直接RPCとしての悪用はできない。デフォルト権限任せにせず、念のためPUBLIC・anon・authenticatedのEXECUTEも明示的に剥奪する。
revoke execute on function public.check_vacant_slot_application_requested_time() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- vacant_slot_applications: 直接のINSERT/UPDATE/DELETEを全ロールで閉じる（RLS + GRANT）
-- ---------------------------------------------------------------------------
-- 旧 "vsa: cast が自分の申請を全操作"（FOR ALL）は、キャストが自分の申請のstatus(approved化)・shift_id・
-- vacant_slot_id・希望時刻を直接書き換えられた。その後の分割ポリシーでも、
--   ・管理者がstatusを直接rejectedにする／approved申請を直接削除してconfirmed shiftだけを残す
--   ・キャストが申請を直接INSERTして、管理者通知・shift整合性を迂回する
-- といった不整合を作れた。申請の作成・更新・削除は、下記の管理されたRPC
-- （apply / cancel / review / set_published / delete_vacant_slot）と、shiftsガードトリガーだけが行う。
-- 参照(SELECT)だけを残す: キャストは自分の申請、管理者は自店舗の申請。
-- RLSは20260526142207_initial_schema.sqlで既に有効化済みだが、既存状態任せにせずここでも明示する（冪等。
-- 既に有効な環境では何も変わらない）。
alter table public.vacant_slot_applications enable row level security;

drop policy if exists "vsa: cast が自分の申請を全操作" on public.vacant_slot_applications;
drop policy if exists "vsa: admin が全操作" on public.vacant_slot_applications;
drop policy if exists "vsa: cast が自分の申請を参照" on public.vacant_slot_applications;

create policy "vsa: cast が自分の申請を参照" on public.vacant_slot_applications
  for select to authenticated
  using (cast_id = auth.uid());

-- 「vsa: admin が同店舗の申請を参照」という名前のポリシーは、既存migration履歴のどこにも存在しない
-- （grep済み）ため、本migrationで新規追加するものと確認できる。再実行時に「policy already exists」で
-- 失敗しないよう、他の箇所と同様にdrop policy if existsを対にする。
drop policy if exists "vsa: admin が同店舗の申請を参照" on public.vacant_slot_applications;
create policy "vsa: admin が同店舗の申請を参照" on public.vacant_slot_applications
  for select to authenticated
  using (
    public.my_role() = 'admin'
    and vacant_slot_id in (select id from public.vacant_slots where store_id = public.my_store_id())
  );

-- INSERT/UPDATE/DELETE のポリシーは作らない（RLSで拒否）。GRANTも剥奪して二重に閉じる。
revoke all on table public.vacant_slot_applications from anon;
revoke insert, update, delete, truncate, references, trigger on table public.vacant_slot_applications from authenticated;
grant select on table public.vacant_slot_applications to authenticated;

-- ---------------------------------------------------------------------------
-- RPC（SECURITY DEFINER・search_path=''。1呼び出し=1トランザクションで、途中エラーは全体ロールバック）
-- ---------------------------------------------------------------------------
-- 空き枠の変更・削除・申請・承認は、空き枠単位のアドバイザリロック
-- pg_advisory_xact_lock(hashtextextended('vacant_slot:' || 空き枠id, 0)) で直列化する。
-- ロック取得後の読み取りは常に最新のコミット済み状態を見る。
-- これらのRPCは、shiftsガードトリガーを「管理された操作」として通すため、トランザクション内でのみ有効な
-- 設定 app.vsa_managed='on' を立てる（ユーザーはこの設定を変更できない。トランザクション終了で消える）。

-- 【キャスト】空き枠へ申請する: shift(提出済み)作成 → 申請作成 → 同店舗の管理者へのアプリ内通知 を
-- 1トランザクションで行う。いずれかが失敗すれば全部なかったことになる（孤立したshift・通知だけを残さない）。
-- キャスト(my_role() = 'cast')のみ実行できる。管理者・ownerは実行不可。
-- 希望時刻がnull/nullなら公開枠全体を希望したものとして扱う。
-- 希望時刻・終了済み・満員・shift内容の一致などの検証は、申請INSERTのトリガー群が行う。
-- SECURITY DEFINER（理由: 申請への直接INSERTと通知の直接INSERTを閉じたため）。認可はこの関数内で明示する:
--   ロールがcast／空き枠は「公開中かつ自店舗」／shiftは本人・自店舗・提出済みで新規作成。
-- 通知の宛先（同店舗の有効な管理者）と文面はDBが決める。管理者のuuidは呼び出し元へ返さない。
-- 戻り値(jsonb): 申請行の全列（id, shift_id, status ...）＋ "notified_count"（通知を作成した管理者の人数）。
create or replace function public.apply_vacant_slot(
  p_vacant_slot_id uuid,
  p_requested_start_time time default null,
  p_requested_end_time time default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_slot     public.vacant_slots%rowtype;
  v_start    time;
  v_end      time;
  v_shift_id uuid;
  v_app      public.vacant_slot_applications%rowtype;
  v_admins   uuid[];
  v_title    text := '空き枠申請が届きました';
  v_body     text;
  v_link     text := '/admin/vacant-slots';
begin
  if v_uid is null or public.my_role() is distinct from 'cast' then
    raise exception '権限がありません（キャストのみ申請できます）' using errcode = '42501';
  end if;
  perform set_config('app.vsa_managed', 'on', true);

  if (p_requested_start_time is null) <> (p_requested_end_time is null) then
    raise exception '開始時刻と終了時刻は両方指定してください' using errcode = '23514';
  end if;

  -- 非公開化・削除・承認と直列化する。ロック取得後に空き枠を読むため、直前に非公開化された枠は見えず拒否される
  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || p_vacant_slot_id::text, 0));

  -- 他店舗・非公開の空き枠はここで拒否する（RLSではなく明示的な条件）
  select * into v_slot
  from public.vacant_slots
  where id = p_vacant_slot_id and is_published = true and store_id = public.my_store_id();
  if not found then
    raise exception 'この空き枠には申請できません' using errcode = '23503';
  end if;

  if p_requested_start_time is not null then
    v_start := p_requested_start_time;
    v_end   := p_requested_end_time;
  else
    v_start := v_slot.start_time;
    v_end   := v_slot.end_time;
  end if;

  insert into public.shifts (cast_id, store_id, room_id, area_id, date, start_time, end_time, status, notes)
  values (v_uid, v_slot.store_id, v_slot.room_id, v_slot.area_id,
          public.vacant_slot_effective_date(v_slot.date, v_slot.start_time, p_requested_start_time),
          v_start, v_end, 'submitted', '空き枠への応募')
  returning id into v_shift_id;

  insert into public.vacant_slot_applications (vacant_slot_id, cast_id, shift_id, requested_start_time, requested_end_time)
  values (v_slot.id, v_uid, v_shift_id, p_requested_start_time, p_requested_end_time)
  returning * into v_app;

  -- 同店舗の有効な管理者へのアプリ内通知（失敗すれば申請・shiftごとロールバックされる）
  select coalesce(array_agg(u.id order by u.id), '{}') into v_admins
  from public.users u
  where u.role = 'admin' and u.is_active and u.store_id = v_slot.store_id;
  v_body := public.vacant_slot_format_date(v_slot.date) || ' ' || public.vacant_slot_format_range(v_slot.start_time, v_start, v_end) || ' への申請';
  perform public.create_notification_internal(a, v_title, v_body, v_link) from unnest(v_admins) as a;

  return to_jsonb(v_app) || jsonb_build_object('notified_count', coalesce(array_length(v_admins, 1), 0));
end;
$$;

-- 【キャスト】自分の保留中の申請を取り消す。申請の削除と、紐づく仮予定shiftの削除を同一トランザクションで行う。
-- shiftが削除できなければ例外にして申請の削除も含めて全体をロールバックする。
-- キャスト(my_role() = 'cast')のみ実行できる。管理者・ownerは実行不可。
-- SECURITY DEFINER（理由: 申請への直接DELETEを閉じたため）。認可: ロールがcast・申請は本人の保留中のみ。
create or replace function public.cancel_vacant_slot_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_slot_id  uuid;
  v_shift_id uuid;
  v_rows     integer;
begin
  if v_uid is null or public.my_role() is distinct from 'cast' then
    raise exception '権限がありません（キャストのみ取り消せます）' using errcode = '42501';
  end if;
  perform set_config('app.vsa_managed', 'on', true);

  select vacant_slot_id into v_slot_id
  from public.vacant_slot_applications
  where id = p_application_id and cast_id = v_uid;
  if not found then
    raise exception '取り消せる申請がありません' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || v_slot_id::text, 0));

  delete from public.vacant_slot_applications
  where id = p_application_id and cast_id = v_uid and status = 'pending'
  returning shift_id into v_shift_id;
  if not found then
    raise exception '取り消せる申請がありません（承認済み・不承認の申請は取り消せません）' using errcode = '23514';
  end if;

  if v_shift_id is not null then
    delete from public.shifts where id = v_shift_id and cast_id = v_uid and status in ('draft', 'submitted');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception '仮予定の削除に失敗しました' using errcode = '23514';
    end if;
  end if;
end;
$$;

-- 【管理者】申請の承認・不承認・承認取消を、申請とshiftの更新も含めて1トランザクションで行う。
--   pending  → approved / rejected
--   approved → pending(承認取消) / rejected
--   rejected → approved
-- 承認:  空き枠と申請を行ロック → 承認上限・同一ルーム重複を再確認 →
--        shift確定（申請にshift_idがあれば、そのshiftを「空き枠と希望時刻から算出した正しい内容
--        (room_id・area_id・date・start_time・end_time)」へ明示的に矯正してconfirmedにする。
--        キャストが申請後に自分のshiftを書き換えていても、無関係な内容のまま確定されることはない。
--        cast_id・store_idが一致しないshiftは矯正せず例外。shift_idが無ければconfirmedで新規作成し
--        申請.shift_idへ保存）→ 申請のstatus/reviewed_at/reviewed_by/shift_idを更新
-- 不承認: 申請をrejected・shift_id=nullにしてから紐づく仮予定shiftを削除。削除件数が0件なら例外（全体ロールバック）
-- 承認取消: shiftを提出済みへ戻し、申請をpendingへ戻す。更新件数が0件なら例外（全体ロールバック）。キャストへは通知しない
-- 承認・不承認: 申請者(キャスト)へのアプリ内通知も同じトランザクションで作成する（失敗すれば申請status・shiftの変更ごとロールバック）。
-- 空き枠単位のアドバイザリロック('vacant_slot:'||空き枠id)を、空き枠の行ロックより前に取得する
-- （申請(apply_vacant_slot)・非公開化・削除と同じロックで直列化。最後の1人の承認と新規申請が同時に動いても順序が決まる）。
-- 戻り値(jsonb): 申請行の全列（status, shift_id ...）＋ "notified_count"（通知を作成した人数。取消・冪等時は0）。
-- Web Pushはこの関数に含めず、呼び出し側が /api/push/dispatch（自分が作成した未送信の通知だけを送るAPI）で送る。
-- SECURITY DEFINER（理由: 申請への直接UPDATEと通知の直接INSERTを閉じたため）。認可: ロールがadmin・空き枠は自店舗のみ。
-- shiftsのガードトリガー(shifts_a_guard_linked_status)と同じ規則（承認上限・ルーム重複・通知・reviewed_by）を、
-- この関数は空き枠画面から、ガードトリガーはシフト管理・修正申請管理などの経路から通す。
-- 承認上限: 空き枠行を FOR UPDATE でロックするため、同一空き枠への同時承認は直列化される。
-- ロック順序は常に「空き枠 → 申請（→ ルーム単位のアドバイザリロック）」で固定しデッドロックを避ける。
create or replace function public.review_vacant_slot_application(
  p_application_id uuid,
  p_next_status public.request_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

    -- 空き枠の承認は、店舗設定やルーム定員に関わらず同じルームの確定シフトとの重複を常に禁止する
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

-- 【管理者】空き枠の公開・非公開切替を、紐づく仮予定shiftの削除/復元も含めて1トランザクションで行う。
-- 非公開: 保留中・承認済みの申請に紐づくshiftを削除（申請自体は残す。shift_idはFKのon delete set nullでnullになる）。
--         削除件数が対象の申請数と一致しなければ例外。
-- 公開:   shiftの無い保留中・承認済み申請について、希望時刻・翌日補正済みの日付でshiftを作り直し、
--         申請.shift_idへ保存する。1件でも復元できない（時間帯の重複など）場合は例外にして、
--         公開状態の変更を含めてRPC全体をロールバックする（=非公開のまま・shiftは何も復元されない）。
--         「approvedなのにshiftが無い状態で公開中になる」ことはない。
-- 申請(apply_vacant_slot)と同じ空き枠単位のアドバイザリロックで直列化する。
-- SECURITY DEFINER（理由: 申請・shiftの直接DMLを閉じたため）。認可: ロールがadmin・空き枠は自店舗のみ。
create or replace function public.set_vacant_slot_published(p_slot_id uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot     public.vacant_slots%rowtype;
  v_app      record;
  v_shift_id uuid;
  v_expected integer;
  v_deleted  integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  perform set_config('app.vsa_managed', 'on', true);

  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || p_slot_id::text, 0));

  select * into v_slot
  from public.vacant_slots
  where id = p_slot_id and store_id = public.my_store_id()
  for update;
  if not found then
    raise exception '対象の空き枠が見つかりません' using errcode = 'P0002';
  end if;

  update public.vacant_slots set is_published = p_published where id = v_slot.id;

  if not p_published then
    select count(*) into v_expected
    from public.vacant_slot_applications
    where vacant_slot_id = v_slot.id and status in ('pending', 'approved') and shift_id is not null;

    delete from public.shifts
    where store_id = v_slot.store_id
      and id in (
        select shift_id from public.vacant_slot_applications
        where vacant_slot_id = v_slot.id and status in ('pending', 'approved') and shift_id is not null
      );
    get diagnostics v_deleted = row_count;
    if v_deleted <> v_expected then
      raise exception '紐づくシフトを削除できませんでした' using errcode = 'P0002';
    end if;
  else
    for v_app in
      select * from public.vacant_slot_applications
      where vacant_slot_id = v_slot.id and status in ('pending', 'approved') and shift_id is null
      order by created_at
      for update
    loop
      begin
        insert into public.shifts (cast_id, store_id, room_id, area_id, date, start_time, end_time, status)
        values (
          v_app.cast_id, v_slot.store_id, v_slot.room_id, v_slot.area_id,
          public.vacant_slot_effective_date(v_slot.date, v_slot.start_time,
            case when v_app.requested_start_time is not null and v_app.requested_end_time is not null
                 then v_app.requested_start_time end),
          case when v_app.requested_start_time is not null and v_app.requested_end_time is not null
               then v_app.requested_start_time else v_slot.start_time end,
          case when v_app.requested_start_time is not null and v_app.requested_end_time is not null
               then v_app.requested_end_time else v_slot.end_time end,
          case when v_app.status = 'approved' then 'confirmed'::public.shift_status else 'submitted'::public.shift_status end
        )
        returning id into v_shift_id;

        update public.vacant_slot_applications set shift_id = v_shift_id where id = v_app.id;
      exception when exclusion_violation then
        raise exception '他のシフトと時間帯が重なるため、申請中・承認済みのシフトを復元できず、公開に戻せませんでした（公開状態は変更していません）'
          using errcode = '23P01';
      end;
    end loop;
  end if;
end;
$$;

-- 【管理者】空き枠の削除。保留中の申請に紐づく仮予定shiftを消してから空き枠を削除する（1トランザクション）。
-- 空き枠の削除で申請行もカスケード削除される。承認済み申請の確定shiftは従来どおり残す（申請行のみ消える）。
-- SECURITY DEFINER（理由: 申請・shiftの直接DMLを閉じたため）。認可: ロールがadmin・空き枠は自店舗のみ。
create or replace function public.delete_vacant_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_row public.vacant_slots%rowtype;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  perform set_config('app.vsa_managed', 'on', true);

  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || p_slot_id::text, 0));

  select * into v_slot_row
  from public.vacant_slots
  where id = p_slot_id and store_id = public.my_store_id()
  for update;
  if not found then
    raise exception '対象の空き枠が見つかりません' using errcode = 'P0002';
  end if;

  delete from public.shifts
  where store_id = v_slot_row.store_id
    and id in (
      select shift_id from public.vacant_slot_applications
      where vacant_slot_id = v_slot_row.id and status = 'pending' and shift_id is not null
    );

  delete from public.vacant_slots where id = v_slot_row.id;
end;
$$;

-- 【管理者】空き枠を作成し、同じトランザクションで同店舗の有効なキャスト全員へアプリ内通知を登録する。
-- 通知の登録に失敗した場合は空き枠の作成ごとロールバックされ、「空き枠だけ作られて通知が飛ばない」状態は残らない。
-- 店舗・作成者・通知の宛先・文面・リンクはすべてDB側で決める（呼び出し元の店舗・auth.uid()。文面は
-- 「M/d(曜) HH:MM〜(翌)HH:MM の空き枠」。呼び出し側は通知内容を指定できない）。管理者のみ実行できる。
-- 通知は空き枠の作成者（管理者）の店舗の、is_active な role=cast のユーザーだけが対象
-- （他店舗のキャスト・無効なキャストには作成されない）。
-- Web Push（外部処理）はこのRPCに含めず、呼び出し側が /api/push/dispatch で別途送る（Push失敗で空き枠は消えない）。
-- SECURITY DEFINER（理由: notificationsへの直接INSERTを閉じたため）。認可: ロールがadmin・room/areaは自店舗のみ。
-- 戻り値: {"slot_id": uuid, "notified_count": n}
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
  v_notified integer := 0;
  v_body     text;
  v_cast     uuid;
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

  v_body := public.vacant_slot_format_date(p_date) || ' ' || public.vacant_slot_format_range(p_start_time, p_start_time, p_end_time) || ' の空き枠';
  for v_cast in
    select id from public.users where store_id = v_store and role = 'cast' and is_active order by id
  loop
    perform public.create_notification_internal(v_cast, '空き枠が追加されました', v_body, '/cast/vacant-slots');
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object('slot_id', v_slot_id, 'notified_count', v_notified);
end;
$$;

-- ---------------------------------------------------------------------------
-- notifications: 直接書き込みを閉じ、通知はDB内の専用経路（RPC・トリガー）だけが作成する
-- ---------------------------------------------------------------------------
-- 従来: INSERTポリシーが with check (true)・対象ロールPUBLIC で、anon/authenticatedに全テーブル権限があった。
-- 未ログインを含む誰でも、任意の宛先(user_id)・title・body・linkの通知を作れた。
--  ・created_by（作成者）・push_sent_at（Web Push送信済み時刻）を追加。/api/push/dispatch は「呼び出し元が作成した
--    未送信の通知」だけを送る（任意の宛先・文面・リンクを受け取らない）。
--  ・link はアプリ内の許可パス（/cast /admin /notifications /dashboard 配下の相対パス）だけ。既存行は検査しない(not valid)。
--  ・INSERTポリシーを削除。anonの権限を全剥奪。authenticatedは SELECT と 自分の通知の read_at 更新のみ。
--  ・service_role（サーバーAPI。支払通知書の発行など）は従来どおり全権限。
alter table public.notifications
  add column created_by uuid references public.users(id) on delete set null,
  add column push_sent_at timestamptz;

alter table public.notifications add constraint notifications_link_allowed check (
  link is null
  or link ~ '^/(cast|admin|notifications|dashboard)(/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_=&.%-]*)?$'
) not valid;

-- RLSは20260526142207_initial_schema.sqlで既に有効化済みだが、既存状態任せにせずここでも明示する（冪等）。
alter table public.notifications enable row level security;

-- 以下3件はALTER POLICYのみ（USING句は変更しない）。元定義をローカルのmigration履歴から確認済み:
--   "notif: 自分の通知を参照"                : 20260526142207_initial_schema.sql
--     for select using (user_id = auth.uid())  — 対象ロール未指定（＝全ロール対象。anonも含む）だったものを、
--     本行でauthenticatedのみへ narrow する。USING句自体は変更しない。
--   "notif: admin が同店舗ユーザー宛の通知を参照" : 20260816070000_admin_read_store_notifications.sql
--     for select using (my_role() = 'admin' and user_id in (select id from public.users where store_id = my_store_id()))
--     こちらも対象ロール未指定だったものをauthenticatedのみへ narrow する。USING句は変更しない。
--   "notif: 自分の通知を更新（既読）"          : 20260526142207_initial_schema.sql
--     for update using (user_id = auth.uid())  — 元々WITH CHECKの明示指定は無かった。PostgreSQLはUPDATE
--     ポリシーでWITH CHECK省略時にUSING句を暗黙的に流用する仕様のため、本行が明示するWITH CHECKの内容
--     (user_id = auth.uid()) は元々の暗黙の挙動と同一であり、動作は変わらない（明示化のみ）。
-- 存在確認は本ファイル冒頭のPREFLIGHTブロックで実施済み。
drop policy if exists "notif: insert は全員許可（サーバーサイドから）" on public.notifications;
alter policy "notif: 自分の通知を参照" on public.notifications to authenticated;
alter policy "notif: admin が同店舗ユーザー宛の通知を参照" on public.notifications to authenticated;
alter policy "notif: 自分の通知を更新（既読）" on public.notifications to authenticated with check (user_id = auth.uid());

revoke all on table public.notifications from anon;
revoke all on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- 通知を1件作る内部関数（SECURITY INVOKER・search_path=''）。EXECUTEは誰にも与えない（呼べるのは所有者権限で動く
-- 下記のSECURITY DEFINER関数・トリガーだけ）。宛先の所属店舗(store_id)と作成者(auth.uid())をDBが設定する。
-- 宛先が存在しなければ何も作らない（null を返す）。
create or replace function public.create_notification_internal(p_user_id uuid, p_title text, p_body text, p_link text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception '通知のタイトルがありません' using errcode = '23514';
  end if;
  insert into public.notifications (user_id, store_id, title, body, link, created_by)
  select u.id, u.store_id, p_title, p_body, p_link, auth.uid()
  from public.users u
  where u.id = p_user_id
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_notification_internal(uuid, text, text, text) from public, anon, authenticated;

-- sync_vacant_slot_approved_count(uuid) は、トリガーからだけ呼ばれる集計関数（SECURITY DEFINER）。
-- PUBLIC/anonを含む一般ロールから、任意の空き枠idで直接実行できたため、EXECUTEを剥奪する。
revoke execute on function public.sync_vacant_slot_approved_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 旧自動承認トリガーの廃止と、空き枠申請に紐づくshiftのガードトリガー
-- ---------------------------------------------------------------------------
-- 以下のガードトリガーはshiftsの全操作経路に及ぶため、RLSが確実に有効であることをここでも明示する
-- （20260526142207_initial_schema.sqlで既に有効化済み。冪等）。
alter table public.shifts enable row level security;

-- 旧 trg_sync_vacant_slot_application_on_shift_confirm（20260828050000）は、shifts.statusがconfirmedになると
-- 申請を直接approvedにするだけだった。承認上限の再確認・空き枠ロック・reviewed_by・承認通知・申請とshiftの
-- 単一トランザクション処理をどれも通らないため、シフト管理・修正申請管理などから承認RPCを迂回できた。
drop trigger if exists trg_sync_vacant_slot_application_on_shift_confirm on public.shifts;
drop function if exists public.sync_vacant_slot_application_on_shift_confirm();

-- 既存のルーム重複トリガー関数 check_shift_double_booking()（20260819070000）は search_path 未指定で、`rooms` `shifts` を
-- スキーマ修飾なしで参照している。本migrationの管理RPC（set search_path = ''）の中でルーム付きshiftをconfirmedにすると、
-- この関数が呼び出し元の search_path='' を引き継いで `relation "rooms" does not exist` になり、ルーム付き空き枠の承認や
-- ルーム付きshiftの修正申請承認が失敗する。関数本体は変えず、search_path だけを public に固定する（SECURITY INVOKERのまま）。
alter function public.check_shift_double_booking() set search_path = public;

-- 【ガード1】申請に紐づくshiftの status 変更（BEFORE UPDATE OF status）。承認RPCと同じ規則を、どの経路でも通す:
--   仮予定(submitted/draft) → confirmed : 承認。空き枠ロック→承認上限→ルーム重複を再確認し、shift内容を空き枠と希望時刻から
--                                        算出した正しい値へ矯正、申請をapproved(reviewed_by/at保存)、キャストへ承認通知（1回）
--   confirmed → submitted/draft          : 確定取消。申請をpendingへ戻す
--   → rejected（差し戻し）               : 申請をrejected・shift_id=nullにして不承認通知（shift自体は差し戻し状態で残る）
--   confirmed ⇔ modification_requested   : キャストの修正申請・その処理。申請はapprovedのまま
--   上記以外                              : 例外（申請とshiftが食い違う遷移は作らせない）
-- 承認RPC・空き枠RPCなどの管理された操作は app.vsa_managed='on' で本トリガーを通さない（自前で整合性を保つ）。
-- 例外や途中失敗は、shiftのUPDATEを含む全体をロールバックする。
-- SECURITY DEFINER（理由: 一般ユーザーは申請を更新できない）。認可: shiftを更新できる呼び出し元の変更にだけ反応する（RLSで許可済みの更新）。
create or replace function public.guard_linked_shift_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app   public.vacant_slot_applications%rowtype;
  v_slot  public.vacant_slots%rowtype;
  v_actor uuid := auth.uid();
  v_count integer;
  v_start time;
  v_end   time;
  v_date  date;
  v_title text;
  v_body  text;
begin
  if coalesce(current_setting('app.vsa_managed', true), '') = 'on' then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_app from public.vacant_slot_applications where shift_id = new.id;
  if not found then
    return new;
  end if;

  -- 空き枠単位のロック（承認RPC・申請・非公開化・削除と同じ）→ 空き枠行 → 申請行
  perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || v_app.vacant_slot_id::text, 0));
  select * into v_slot from public.vacant_slots where id = v_app.vacant_slot_id for update;
  select * into v_app from public.vacant_slot_applications where id = v_app.id and shift_id = new.id for update;
  if not found then
    return new; -- ロック待ちの間に紐づきが解除された
  end if;

  if v_app.requested_start_time is not null and v_app.requested_end_time is not null then
    v_start := v_app.requested_start_time;
    v_end   := v_app.requested_end_time;
  else
    v_start := v_slot.start_time;
    v_end   := v_slot.end_time;
  end if;
  v_date := public.vacant_slot_effective_date(v_slot.date, v_slot.start_time,
              case when v_app.requested_start_time is not null and v_app.requested_end_time is not null
                   then v_app.requested_start_time end);

  if new.status = 'confirmed' and old.status in ('submitted', 'draft') then
    if v_app.status = 'pending' then
      select count(*) into v_count
      from public.vacant_slot_applications
      where vacant_slot_id = v_slot.id and status = 'approved' and id <> v_app.id;
      if v_count >= v_slot.capacity then
        raise exception '募集人数（%人）に達しています', v_slot.capacity using errcode = '23514';
      end if;

      new.room_id := v_slot.room_id;
      new.area_id := v_slot.area_id;
      new.date := v_date;
      new.start_time := v_start;
      new.end_time := v_end;

      if v_slot.room_id is not null then
        perform pg_advisory_xact_lock(hashtextextended(v_slot.room_id::text, 0));
        if exists (
          select 1 from public.shifts sh
          where sh.store_id = v_slot.store_id and sh.room_id = v_slot.room_id and sh.status = 'confirmed' and sh.id <> new.id
            and tsrange(
                  (sh.date + sh.start_time)::timestamp,
                  (sh.date + sh.end_time + (case when sh.end_time <= sh.start_time then interval '1 day' else interval '0' end))::timestamp,
                  '[)'
                ) && tsrange(
                  (v_date + v_start)::timestamp,
                  (v_date + v_end + (case when v_end <= v_start then interval '1 day' else interval '0' end))::timestamp,
                  '[)')
        ) then
          raise exception 'shifts_no_double_booking: overlapping confirmed shift in the same room'
            using errcode = '23P01';
        end if;
      end if;

      update public.vacant_slot_applications
      set status = 'approved', reviewed_at = now(), reviewed_by = v_actor
      where id = v_app.id;
      v_title := '空き枠申請が承認されました';
    elsif v_app.status <> 'approved' then
      raise exception 'この申請の状態からはシフトを確定できません' using errcode = '22023';
    end if;

  elsif old.status = 'confirmed' and new.status in ('submitted', 'draft') then
    if v_app.status = 'approved' then
      update public.vacant_slot_applications
      set status = 'pending', reviewed_at = null, reviewed_by = null
      where id = v_app.id;
    end if;

  elsif new.status = 'rejected' then
    update public.vacant_slot_applications
    set status = 'rejected', reviewed_at = now(), reviewed_by = v_actor, shift_id = null
    where id = v_app.id;
    v_title := '空き枠申請が不承認になりました';

  elsif (old.status = 'confirmed' and new.status = 'modification_requested')
     or (old.status = 'modification_requested' and new.status = 'confirmed') then
    null; -- キャストの修正申請とその処理。申請はapprovedのまま

  else
    raise exception '空き枠申請に紐づくシフトは、この状態には変更できません' using errcode = '22023';
  end if;

  if v_title is not null then
    v_body := public.vacant_slot_format_date(v_slot.date) || ' ' || public.vacant_slot_format_range(v_slot.start_time, v_start, v_end) || ' の空き枠';
    perform public.create_notification_internal(v_app.cast_id, v_title, v_body, '/cast/vacant-slots');
    -- このshiftについては申請の通知を作成済み。一般のシフト通知(notify_shift_update)は重複させない
    perform set_config('app.shift_notified', new.id::text, true);
  end if;
  return new;
end;
$$;

-- 【ガード2】申請に紐づくshiftの削除（BEFORE DELETE）。申請だけが残る（approved/pendingなのにshiftが無い）状態を作らない:
-- 紐づく申請を同じトランザクションで削除する（キャストの取消・管理者の削除・修正申請のキャンセルのどれでも）。
-- 承認済み申請の場合は approved_count も再集計される（空き枠が再び埋まる）。管理された操作は app.vsa_managed で通さない。
create or replace function public.guard_linked_shift_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid;
begin
  if coalesce(current_setting('app.vsa_managed', true), '') = 'on' then
    return old;
  end if;
  select vacant_slot_id into v_slot_id from public.vacant_slot_applications where shift_id = old.id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('vacant_slot:' || v_slot_id::text, 0));
    delete from public.vacant_slot_applications where shift_id = old.id;
  end if;
  return old;
end;
$$;

-- 【ガード3】修正申請(shift_modification_requests)にpendingの申請が紐づくshiftの直接操作を防ぐ（v7で追加）。
-- 旧: shiftsの「cast が確定シフトに修正申請」ポリシー（20260819080000）が、confirmed→modification_requestedへの
--     直接UPDATEをキャストへ許可していたため、create_shift_modification_requestを迂回して
--     「shiftはmodification_requestedだが申請が無い・管理者通知も無い」状態を作れた（本migrationでこのポリシーを削除）。
--     また、管理者の「shifts: admin が同店舗を全操作」（FOR ALL）は残るため、pendingの修正申請があるshiftを
--     管理者が直接confirmed/rejected/submitted等へ変更・削除すると「申請はpendingのまま・shiftだけ変わる／消える」
--     不整合を作れた。guard_linked_shift_status/deleteはvacant_slot_applicationsしか見ておらず、これを防げない。
-- 新: pendingのshift_modification_requestsが紐づくshiftのstatus変更・削除は、管理されたRPC
--     （create_shift_modification_request / review_shift_modification_request。app.smr_managed='on'で
--     このガードを通さず自前で整合性を保つ）だけが行える。それ以外からの直接操作は例外で拒否する。
--     service_role/postgres（サーバーAPI・管理用スクリプト。auth.uid()がnull）は、RLSと同じく信頼境界として対象外。
create or replace function public.guard_linked_modification_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending boolean;
begin
  -- service_role/postgres（サーバーAPI・管理用スクリプト）はauth.uid()がnullになる。他のガード・RLSと同じく
  -- 信頼境界として対象外にする（service_roleはRLSも迂回する既存の設計と揃える）
  if auth.uid() is null then
    return new;
  end if;
  if coalesce(current_setting('app.smr_managed', true), '') = 'on' then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  select exists(
    select 1 from public.shift_modification_requests where shift_id = new.id and status = 'pending'
  ) into v_pending;
  if v_pending then
    raise exception 'この修正申請待ちのシフトは、修正申請の承認・却下からのみ状態を変更できます' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.guard_linked_modification_request_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending boolean;
begin
  -- service_role/postgres（サーバーAPI・管理用スクリプト）はauth.uid()がnullになる。他のガード・RLSと同じく
  -- 信頼境界として対象外にする（service_roleはRLSも迂回する既存の設計と揃える）
  if auth.uid() is null then
    return old;
  end if;
  if coalesce(current_setting('app.smr_managed', true), '') = 'on' then
    return old;
  end if;
  select exists(
    select 1 from public.shift_modification_requests where shift_id = old.id and status = 'pending'
  ) into v_pending;
  if v_pending then
    raise exception 'この修正申請待ちのシフトは、修正申請の承認・却下からのみ削除できます' using errcode = '22023';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- シフト・修正申請の通知（従来はブラウザが notifications へ直接INSERTしていた）を、DBトリガーで作成する
-- ---------------------------------------------------------------------------
-- 宛先・文面・リンクはDBが決める。変更と同じトランザクションで作られ、通知の作成に失敗すれば変更ごとロールバックされる。
--  ・管理者(自店舗)がキャストのシフトを 確定/差し戻し/確定取消/内容変更/削除 → そのキャストへ
--  ・キャストが差し戻されたシフトを再提出（rejected→submitted） → 同店舗の有効な管理者全員へ
--    （従来はキャストのブラウザがusersから管理者を検索していたが、RLSで0件になり通知が届いていなかった）
--  ・キャストが修正申請を作成 → 同店舗の有効な管理者全員へ（同上）
-- 空き枠申請に紐づくshiftの確定・差し戻しは、ガード1が申請の通知を作るため、一般のシフト通知は作らない（1回だけ）。
-- 修正申請の承認・却下・キャンセルは review_shift_modification_request が通知するため、app.shift_notify_off で抑止する。
create or replace function public.notify_shift_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_title text;
  v_body  text;
  v_loc   text;
  v_name  text;
  v_admin uuid;
begin
  if v_actor is null
     or coalesce(current_setting('app.vsa_managed', true), '') = 'on'
     or coalesce(current_setting('app.shift_notify_off', true), '') = 'on' then
    return null;
  end if;

  if v_actor <> new.cast_id then
    if public.my_role() is distinct from 'admin' or public.my_store_id() is distinct from new.store_id then
      return null;
    end if;
    if new.status is distinct from old.status then
      if coalesce(current_setting('app.shift_notified', true), '') = new.id::text then
        perform set_config('app.shift_notified', '', true);
        return null;
      end if;
      if old.status = 'modification_requested' then
        return null;
      end if;
      v_title := case new.status
                   when 'confirmed' then 'シフトが確定されました'
                   when 'rejected' then 'シフトが差し戻されました'
                   else 'シフトの確定が取り消されました' end;
      v_body := public.vacant_slot_format_date(new.date) || ' ' || to_char(new.start_time, 'HH24:MI') || '〜' || to_char(new.end_time, 'HH24:MI') || ' のシフト';
    elsif (new.date, new.start_time, new.end_time, new.area_id, new.room_id)
          is distinct from (old.date, old.start_time, old.end_time, old.area_id, old.room_id) then
      v_loc := nullif(concat_ws(' / ', (select name from public.areas where id = new.area_id), (select name from public.rooms where id = new.room_id)), '');
      v_title := 'シフト内容が変更されました';
      v_body := public.vacant_slot_format_date(old.date) || ' ' || to_char(old.start_time, 'HH24:MI') || '〜' || to_char(old.end_time, 'HH24:MI')
             || ' から ' || public.vacant_slot_format_date(new.date) || ' ' || to_char(new.start_time, 'HH24:MI') || '〜' || to_char(new.end_time, 'HH24:MI')
             || coalesce('（' || v_loc || '）', '') || ' に変更されました';
    else
      return null;
    end if;
    perform public.create_notification_internal(new.cast_id, v_title, v_body, '/cast/shifts');

  elsif old.status = 'rejected' and new.status = 'submitted' then
    select coalesce(display_name, 'キャスト') into v_name from public.users where id = new.cast_id;
    v_body := coalesce(v_name, 'キャスト') || ' ／ ' || public.vacant_slot_format_date(new.date) || ' ' || to_char(new.start_time, 'HH24:MI') || '〜' || to_char(new.end_time, 'HH24:MI');
    for v_admin in select id from public.users where role = 'admin' and is_active and store_id = new.store_id order by id loop
      perform public.create_notification_internal(v_admin, 'シフトが再提出されました', v_body, '/admin/shifts');
    end loop;
  end if;
  return null;
end;
$$;

create or replace function public.notify_shift_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or v_actor = old.cast_id
     or coalesce(current_setting('app.vsa_managed', true), '') = 'on'
     or coalesce(current_setting('app.shift_notify_off', true), '') = 'on' then
    return old;
  end if;
  if public.my_role() is distinct from 'admin' or public.my_store_id() is distinct from old.store_id then
    return old;
  end if;
  perform public.create_notification_internal(old.cast_id, 'シフトが削除されました',
    public.vacant_slot_format_date(old.date) || ' ' || to_char(old.start_time, 'HH24:MI') || '〜' || to_char(old.end_time, 'HH24:MI') || ' のシフトが管理者によって削除されました',
    '/cast/shifts');
  return old;
end;
$$;

create or replace function public.notify_modification_request_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_admin uuid;
begin
  if auth.uid() is null or auth.uid() <> new.requested_by then
    return null;
  end if;
  select * into v_shift from public.shifts where id = new.shift_id;
  if not found then
    return null;
  end if;
  for v_admin in select id from public.users where role = 'admin' and is_active and store_id = v_shift.store_id order by id loop
    perform public.create_notification_internal(v_admin, 'シフト修正申請が届きました',
      public.vacant_slot_format_date(v_shift.date) || ' のシフトへの修正申請', '/admin/modification-requests');
  end loop;
  return null;
end;
$$;

-- 名前順でガード(a)→通知(z)の順に発火させる（同名テーブルの既存BEFORE/AFTERトリガーとも共存）
drop trigger if exists shifts_a_guard_linked_status on public.shifts;
create trigger shifts_a_guard_linked_status before update of status on public.shifts
  for each row execute function public.guard_linked_shift_status();
drop trigger if exists shifts_a_guard_linked_delete on public.shifts;
create trigger shifts_a_guard_linked_delete before delete on public.shifts
  for each row execute function public.guard_linked_shift_delete();
drop trigger if exists shifts_a_guard_smr_status on public.shifts;
create trigger shifts_a_guard_smr_status before update of status on public.shifts
  for each row execute function public.guard_linked_modification_request_status();
drop trigger if exists shifts_a_guard_smr_delete on public.shifts;
create trigger shifts_a_guard_smr_delete before delete on public.shifts
  for each row execute function public.guard_linked_modification_request_delete();
drop trigger if exists shifts_z_notify_update on public.shifts;
create trigger shifts_z_notify_update after update of status, date, start_time, end_time, area_id, room_id on public.shifts
  for each row execute function public.notify_shift_update();
drop trigger if exists shifts_z_notify_delete on public.shifts;
create trigger shifts_z_notify_delete before delete on public.shifts
  for each row execute function public.notify_shift_delete();
drop trigger if exists smr_notify_created on public.shift_modification_requests;
create trigger smr_notify_created after insert on public.shift_modification_requests
  for each row execute function public.notify_modification_request_created();

revoke execute on function public.guard_linked_shift_status() from public, anon, authenticated;
revoke execute on function public.guard_linked_shift_delete() from public, anon, authenticated;
revoke execute on function public.guard_linked_modification_request_status() from public, anon, authenticated;
revoke execute on function public.guard_linked_modification_request_delete() from public, anon, authenticated;
revoke execute on function public.notify_shift_update() from public, anon, authenticated;
revoke execute on function public.notify_shift_delete() from public, anon, authenticated;
revoke execute on function public.notify_modification_request_created() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- shifts: 修正申請を迂回するcast向けポリシーを削除する（v7で追加）
-- ---------------------------------------------------------------------------
-- "shifts: cast が確定シフトに修正申請"（20260819080000）は、キャストが shifts.status を
-- confirmed から modification_requested へ直接UPDATEすることを許可していた。これは
-- create_shift_modification_request を迂回でき、「shiftはmodification_requestedだが
-- shift_modification_requestsには申請がなく、管理者通知もない」不整合を作れた。
-- 作成は create_shift_modification_request だけが行うため、このポリシーは不要（削除する）。
-- 既存の「shifts: cast が未確定シフト更新」（status in ('draft','submitted','rejected')）はこの遷移を
-- 許可していないため、削除後はキャストによるconfirmed→modification_requestedの直接UPDATEは0件更新で失敗する。
drop policy if exists "shifts: cast が確定シフトに修正申請" on public.shifts;

-- ---------------------------------------------------------------------------
-- shift_modification_requests: 直接のINSERT/UPDATE/DELETEを全ロールで閉じる（RLS + GRANT）
-- ---------------------------------------------------------------------------
-- 旧 "smr: cast が自分の申請を作成/更新/削除" と "smr: admin が同店舗を全操作"（FOR ALL）は、
--   ・キャストが shift_modification_requests へ直接INSERTでき、shiftのstatus変更（別クエリ）が
--     失敗しても申請だけが残る、または逆にshiftだけmodification_requestedになり申請が残らない
--   ・同じshiftへ複数のpending申請を作れる
--   ・管理者が status/reviewed_by 等を直接UPDATEし、review_shift_modification_request を迂回できる
-- といった不整合を作れた。作成は create_shift_modification_request、承認・却下・承認してキャンセルは
-- review_shift_modification_request の管理されたRPCだけが行う。参照(SELECT)だけを残す:
-- キャストは自分の申請、管理者は自店舗の申請。
-- RLSは20260526142207_initial_schema.sqlで既に有効化済みだが、既存状態任せにせずここでも明示する（冪等）。
alter table public.shift_modification_requests enable row level security;

drop policy if exists "smr: admin が同店舗を全操作" on public.shift_modification_requests;
drop policy if exists "smr: cast が自分の申請を作成" on public.shift_modification_requests;
drop policy if exists "smr: cast が保留中の自分の申請を更新" on public.shift_modification_requests;
drop policy if exists "smr: cast が保留中の自分の申請を削除" on public.shift_modification_requests;
drop policy if exists "smr: cast が自分の申請を参照" on public.shift_modification_requests;

create policy "smr: cast が自分の申請を参照" on public.shift_modification_requests
  for select to authenticated
  using (requested_by = auth.uid());

-- 「smr: admin が同店舗の申請を参照」という名前のポリシーも、既存migration履歴のどこにも存在しない
-- （grep済み）ため新規追加と確認できる。同様にdrop policy if existsを対にする。
drop policy if exists "smr: admin が同店舗の申請を参照" on public.shift_modification_requests;
create policy "smr: admin が同店舗の申請を参照" on public.shift_modification_requests
  for select to authenticated
  using (
    public.my_role() = 'admin'
    and shift_id in (select id from public.shifts where store_id = public.my_store_id())
  );

-- INSERT/UPDATE/DELETE のポリシーは作らない（RLSで拒否）。GRANTも剥奪して二重に閉じる。
revoke all on table public.shift_modification_requests from anon;
revoke insert, update, delete, truncate, references, trigger on table public.shift_modification_requests from authenticated;
grant select on table public.shift_modification_requests to authenticated;

-- 同じshiftに複数のpending申請を作れないようにする一意インデックス（トリガー内のexists確認だけでは
-- 同時INSERTで複数作れる可能性があるため、最終防衛として設置）。承認・却下・承認してキャンセルの後は
-- statusがpendingでなくなるため、再度そのshiftへ新しいpending申請を作れる。
-- 重複データの有無は、本ファイル冒頭のPREFLIGHTブロックで先に検査済み（このCREATE UNIQUE INDEXより前に
-- 重複があれば例外で停止している。ここでは重複が無いことを前提にインデックスを作成するだけ）。
create unique index uq_shift_modification_requests_pending_shift_id
  on public.shift_modification_requests (shift_id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 【キャスト】確定シフトの修正申請を作成する（shiftのstatus変更・申請の作成・管理者通知を1トランザクションで）
-- ---------------------------------------------------------------------------
-- 従来はブラウザが shifts への UPDATE と shift_modification_requests への INSERT を Promise.all で
-- 別々に送っており、片方だけ成功する・通知だけ失敗する（通知トリガーは申請のINSERTが成功して初めて発火する）
-- といった不整合が起こり得た。認可: 呼び出し元がそのshiftのcast本人・自店舗・shift.status='confirmed'。
-- 既にpendingの修正申請があるshiftへは追加できない（exists確認＋上の一意インデックスの二重防御）。
-- 申請のINSERTは smr_notify_created トリガー（AFTER INSERT）が同店舗の管理者への通知を同じトランザクションで
-- 作成する。通知作成に失敗すれば例外が伝播し、shiftのstatus変更を含む全体がロールバックされる。
create or replace function public.create_shift_modification_request(
  p_shift_id uuid,
  p_new_date date default null,
  p_new_start_time time default null,
  p_new_end_time time default null,
  p_reason text default null
)
returns public.shift_modification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_req   public.shift_modification_requests%rowtype;
begin
  if auth.uid() is null or public.my_role() is distinct from 'cast' then
    raise exception '権限がありません（キャストのみ申請できます）' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '理由を入力してください' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cast_id is distinct from auth.uid() or v_shift.store_id is distinct from public.my_store_id() then
    raise exception '対象のシフトが見つかりません' using errcode = 'P0002';
  end if;
  if v_shift.status <> 'confirmed' then
    raise exception 'このシフトは修正申請できません' using errcode = '22023';
  end if;
  if exists (select 1 from public.shift_modification_requests where shift_id = p_shift_id and status = 'pending') then
    raise exception 'このシフトへの修正申請は既に受け付けています' using errcode = '23505';
  end if;

  insert into public.shift_modification_requests (shift_id, requested_by, new_date, new_start_time, new_end_time, reason)
  values (p_shift_id, auth.uid(), p_new_date, p_new_start_time, p_new_end_time, btrim(p_reason))
  returning * into v_req;

  -- 直後のshifts UPDATEをガード3（guard_linked_modification_request_status）に通さない
  -- （このRPC自身が申請とshiftの整合性を保証する）
  perform set_config('app.smr_managed', 'on', true);
  update public.shifts set status = 'modification_requested' where id = p_shift_id;

  return v_req;
end;
$$;

revoke execute on function public.create_shift_modification_request(uuid, date, time, time, text) from public, anon;
grant execute on function public.create_shift_modification_request(uuid, date, time, time, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 用途別の通知RPC（SECURITY DEFINER・search_path=''）
-- ---------------------------------------------------------------------------
-- 【管理者】修正申請の承認・却下・承認してキャンセルを、申請・shift・キャストへの通知ごと1トランザクションで行う。
--   approve        : shiftを confirmed（日時は p_date/p_start_time/p_end_time）へ、申請をapprovedへ、「承認されました」通知
--   approve_cancel : 申請をapprovedにしてshiftを削除（紐づく空き枠申請があればガードが同時に整合）、「キャンセルされました」通知
--   reject         : shiftを元の confirmed へ、申請をrejected(理由必須)へ、「却下されました」通知
-- 認可: ロールがadmin・shiftは自店舗のみ・申請はpendingのみ。加えて、申請者がそのshiftの本人であること・
-- shiftが実際に修正依頼中(modification_requested)であることも明示確認する（申請とshiftの状態が
-- 食い違ったまま処理されることを防ぐ）。宛先は申請者、文面・リンクはDBが決める。
create or replace function public.review_shift_modification_request(
  p_request_id uuid,
  p_action text,
  p_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_reject_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.shift_modification_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_title text;
  v_body  text;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'approve_cancel', 'reject') then
    raise exception '不正な操作です' using errcode = '22023';
  end if;

  select * into v_req from public.shift_modification_requests where id = p_request_id for update;
  if not found then
    raise exception '対象の修正申請が見つかりません' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_req.shift_id and store_id = public.my_store_id() for update;
  if not found then
    raise exception '対象の修正申請が見つかりません' using errcode = 'P0002';
  end if;
  if v_req.requested_by is distinct from v_shift.cast_id then
    raise exception '対象の修正申請が見つかりません' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'この修正申請は既に処理されています' using errcode = '22023';
  end if;
  if v_shift.status <> 'modification_requested' then
    raise exception 'このシフトは修正依頼中ではありません' using errcode = '22023';
  end if;

  -- 一般のシフト通知は抑止し、この関数が申請者へ1件だけ通知する。以降のshifts UPDATE/DELETEはガード3
  -- （guard_linked_modification_request_status/delete）に通さない（このRPC自身が整合性を保証する）
  perform set_config('app.shift_notify_off', 'on', true);
  perform set_config('app.smr_managed', 'on', true);

  if p_action = 'approve' then
    if p_date is null or p_start_time is null or p_end_time is null
       or extract(hour from p_start_time) >= 24 or extract(hour from p_end_time) >= 24 then
      raise exception '日付と時刻（00:00〜23:59）を指定してください' using errcode = '23514';
    end if;
    -- 開始=終了は空き枠(create_vacant_slot)と同じ規則で入力ミス扱いとする（24時間勤務の表現には使わない。
    -- 24時を超える深夜シフトは、画面側でTimeSelectの24:00〜29:45表記を00:00〜23:59へ正規化して渡す）
    if p_start_time = p_end_time then
      raise exception '開始時刻と終了時刻に同じ時刻は指定できません' using errcode = '23514';
    end if;
    update public.shifts
    set status = 'confirmed', confirmed_at = now(), date = p_date, start_time = p_start_time, end_time = p_end_time
    where id = v_shift.id;
    update public.shift_modification_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_req.id;
    v_title := 'シフト修正申請が承認されました';
    v_body := public.vacant_slot_format_date(p_date) || ' ' || to_char(p_start_time, 'HH24:MI') || '〜' || to_char(p_end_time, 'HH24:MI') || ' のシフト修正申請';

  elsif p_action = 'approve_cancel' then
    v_title := 'シフトがキャンセルされました';
    v_body := public.vacant_slot_format_date(v_shift.date) || ' ' || to_char(v_shift.start_time, 'HH24:MI') || '〜' || to_char(v_shift.end_time, 'HH24:MI') || ' のシフトがキャンセルされました';
    update public.shift_modification_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_req.id;
    delete from public.shifts where id = v_shift.id;

  else
    if p_reject_reason is null or btrim(p_reject_reason) = '' then
      raise exception '却下理由を入力してください' using errcode = '23514';
    end if;
    update public.shifts set status = 'confirmed' where id = v_shift.id;
    update public.shift_modification_requests
    set status = 'rejected', reject_reason = p_reject_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_req.id;
    v_title := 'シフト修正申請が却下されました';
    v_body := '却下理由: ' || p_reject_reason;
  end if;

  perform public.create_notification_internal(v_req.requested_by, v_title, v_body, '/cast/shifts');
end;
$$;

-- 【管理者】シフト提出リマインド。宛先は自店舗の有効なキャスト（p_cast_ids未指定なら全員、指定時は全員が自店舗のキャストであること）。
-- 文面・リンクはDBが決める。作成した件数を返す。
create or replace function public.send_shift_reminder(p_cast_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid := public.my_store_id();
  v_ids   uuid[];
  v_id    uuid;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' or v_store is null then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_cast_ids is null then
    select coalesce(array_agg(id order by id), '{}') into v_ids
    from public.users where store_id = v_store and role = 'cast' and is_active;
  else
    select coalesce(array_agg(id order by id), '{}') into v_ids
    from public.users where store_id = v_store and role = 'cast' and is_active and id = any(p_cast_ids);
    if coalesce(array_length(v_ids, 1), 0) <> (select count(distinct x) from unnest(p_cast_ids) x) then
      raise exception '自店舗の有効なキャスト以外は指定できません' using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '送信先のキャストがいません' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    perform public.create_notification_internal(v_id, 'シフト提出のお願い', 'まだシフトを提出していない場合は、提出をお願いします', '/cast/shifts');
  end loop;
  return array_length(v_ids, 1);
end;
$$;

-- テスト通知。宛先を指定しない（または自分自身）なら自分宛（誰でも可）。自店舗の有効なキャストを指定できるのは管理者だけ。
-- 文面はDBが決める。作成した件数を返す。
create or replace function public.send_test_notification(p_target_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_target_user_id is null or p_target_user_id = auth.uid() then
    perform public.create_notification_internal(auth.uid(), 'テスト通知', '通知の動作確認です', null);
    return 1;
  end if;
  if public.my_role() is distinct from 'admin'
     or not exists (select 1 from public.users where id = p_target_user_id and role = 'cast' and is_active and store_id = public.my_store_id()) then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  perform public.create_notification_internal(p_target_user_id, 'テスト通知', '管理者からの通知テストです', null);
  return 1;
end;
$$;

revoke execute on function public.review_shift_modification_request(uuid, text, date, time, time, text) from public, anon;
revoke execute on function public.send_shift_reminder(uuid[]) from public, anon;
revoke execute on function public.send_test_notification(uuid) from public, anon;
grant execute on function public.review_shift_modification_request(uuid, text, date, time, time, text) to authenticated;
grant execute on function public.send_shift_reminder(uuid[]) to authenticated;
grant execute on function public.send_test_notification(uuid) to authenticated;

-- 【Web Push】直近1分の送信件数の確認と、未送信通知の確保(push_sent_at設定)を1トランザクションで行う
-- （v7で追加・v8でservice_role専用に閉鎖し、残量計算を修正）。
-- 旧実装は /api/push/dispatch が「直近1分の件数確認」→「未送信通知の取得」→「確保のUPDATE」を別クエリで
-- 順に実行していたため、同じ呼び出し元から同時に複数リクエストが来ると、両方が確認の時点では古い（上限未満の）
-- 件数を見ており、それぞれが別々の未送信通知をclaimして送ってしまい、合計が上限を超える可能性があった。
--
-- v8での修正（レビュー指摘）:
--  (1) v7時点ではauthenticatedにEXECUTEがあり、ブラウザから直接呼べた。auth.uid()で「誰の通知を確保するか」を
--      決めていたため、直接呼び出しでも自分の通知しか触れなかったが、①任意の大きな上限値を指定して連続送信
--      抑止を無効化できる、②returns setof public.notificationsが通知行全体（宛先user_id等）を返すため、
--      ブラウザから呼べば取得できてしまう、という問題があった。
--      → PUBLIC/anon/authenticatedのEXECUTEをすべて剥奪し、service_roleだけが実行できるようにした。
--        呼び出し元の識別はauth.uid()に頼れなくなるため、p_user_idを明示引数にし、
--        /api/push/dispatchは通常クライアント（ユーザーのセッション）でauth.getUser()により本人を確認した後、
--        admin client（service_role）からこのRPCへその user.id を渡して呼び出す。
--        ブラウザから直接叩いても、grantが無いため実行できない（catalog inventoryテストで確認）。
--  (2) v7時点は「v_recentが上限未満ならp_max_batch件をそのまま確保する」実装だったため、
--      例えばv_recent=150・p_max_per_minute=200・p_max_batch=100だと、確保数が上限を無視して100件になり、
--      合計250件を確保できてしまった。→ 確保数を least(p_max_batch, p_max_per_minute - v_recent) に修正し、
--      残り枠（v_room）が0以下なら拒否する。
--  (3) 上限値（p_max_per_minute等）は、呼び出し元がservice_role専用になったため実質的にブラウザ入力では
--      なくなったが、防御的にDB側の固定上限（v_hard_*）でclampし、渡された値がそれを超えても無視する。
create or replace function public.claim_pending_push_notifications(
  p_user_id uuid,
  p_max_per_minute integer default null,
  p_pending_window_minutes integer default null,
  p_max_batch integer default null
)
returns table (id uuid, user_id uuid, store_id uuid, title text, body text, link text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- DB側の絶対上限。呼び出し元が引数でこれを超える値を指定しても、ここでクランプする
  v_hard_max_per_minute     constant integer := 200;
  v_hard_pending_window_min constant integer := 60;
  v_hard_max_batch          constant integer := 100;
  v_max_per_minute integer;
  v_pending_window  integer;
  v_max_batch       integer;
  v_recent integer;
  v_room   integer;
begin
  if p_user_id is null then
    raise exception '不正なパラメータです' using errcode = '22023';
  end if;

  v_max_per_minute := least(coalesce(p_max_per_minute, v_hard_max_per_minute), v_hard_max_per_minute);
  v_pending_window  := least(coalesce(p_pending_window_minutes, v_hard_pending_window_min), v_hard_pending_window_min);
  v_max_batch       := least(coalesce(p_max_batch, v_hard_max_batch), v_hard_max_batch);
  if v_max_per_minute <= 0 or v_pending_window <= 0 or v_max_batch <= 0 then
    raise exception '不正なパラメータです' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push_dispatch:' || p_user_id::text, 0));

  select count(*) into v_recent from public.notifications
  where created_by = p_user_id and push_sent_at >= now() - interval '1 minute';

  v_room := v_max_per_minute - v_recent;
  if v_room <= 0 then
    raise exception '送信が多すぎます。しばらくしてからお試しください' using errcode = '23514';
  end if;

  -- RETURNS TABLE(id, user_id, ...) の各列名はPL/pgSQL側で同名の変数として暗黙宣言されるため、
  -- 埋め込みSQL側の同名の列参照（特にサブクエリ内の非修飾な id 等）と衝突し "ambiguous" になりうる。
  -- サブクエリのテーブルには明示的なエイリアス(t)を付け、列も t.id のように修飾して回避する。
  return query
    update public.notifications n
    set push_sent_at = now()
    where n.id in (
      select t.id from public.notifications t
      where t.created_by = p_user_id and t.push_sent_at is null
        and t.created_at >= now() - (v_pending_window || ' minutes')::interval
      order by t.created_at
      limit least(v_max_batch, v_room)
    )
    returning n.id, n.user_id, n.store_id, n.title, n.body, n.link;
end;
$$;

-- authenticated/anon/PUBLICからは一切実行できない（誰の通知でも指定できるp_user_idを受け取るため、
-- サーバー(service_role)だけが呼べることが前提）。service_roleへのEXECUTEは、20260810000000で設定済みの
-- default privileges（新規関数にはservice_roleへ自動でgrant all）によっても付与されるが、意図を明示するため
-- ここでも明示的にgrantする。
revoke all on function public.claim_pending_push_notifications(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_push_notifications(uuid, integer, integer, integer) to service_role;

-- 未ログイン(anon)からはRPCを呼べないようにする（各関数内でもauth.uid()を確認している）
revoke execute on function public.apply_vacant_slot(uuid, time, time) from public, anon;
revoke execute on function public.cancel_vacant_slot_application(uuid) from public, anon;
revoke execute on function public.review_vacant_slot_application(uuid, public.request_status) from public, anon;
revoke execute on function public.set_vacant_slot_published(uuid, boolean) from public, anon;
revoke execute on function public.delete_vacant_slot(uuid) from public, anon;
revoke execute on function public.create_vacant_slot(date, time, time, uuid, uuid, text, integer) from public, anon;
grant execute on function public.apply_vacant_slot(uuid, time, time) to authenticated;
grant execute on function public.cancel_vacant_slot_application(uuid) to authenticated;
grant execute on function public.review_vacant_slot_application(uuid, public.request_status) to authenticated;
grant execute on function public.set_vacant_slot_published(uuid, boolean) to authenticated;
grant execute on function public.delete_vacant_slot(uuid) to authenticated;
grant execute on function public.create_vacant_slot(date, time, time, uuid, uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: キャストの画面が自分の申請の状態変化（承認・承認取消・不承認・取消）を受け取れるようにする
-- ---------------------------------------------------------------------------
-- 配信対象はRLSのSELECTポリシー（cast_id = auth.uid()）で本人の申請のみに絞られる。
-- 削除イベントでもcast_id等を参照できるよう replica identity full にする（vacant_slots と同じ）。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vacant_slot_applications'
  ) then
    alter publication supabase_realtime add table public.vacant_slot_applications;
  end if;
end
$$;
alter table public.vacant_slot_applications replica identity full;

-- 本ファイル冒頭のBEGIN;に対応するCOMMIT;。ここまでの全文が単一トランザクションとして成功した場合のみ確定する。
-- 途中のいずれかの文（PREFLIGHTの例外を含む）が失敗した場合は、Postgres側で自動的にロールバックされ、
-- ここには到達しない。
commit;

-- ---------------------------------------------------------------------------
-- ロールバック手順（適用後に戻す場合。手動実行用。自動では実行されない）
-- ---------------------------------------------------------------------------
-- alter function public.check_shift_double_booking() reset search_path;
-- drop function if exists public.claim_pending_push_notifications(uuid, integer, integer, integer);
-- drop function if exists public.send_test_notification(uuid);
-- drop function if exists public.send_shift_reminder(uuid[]);
-- drop function if exists public.review_shift_modification_request(uuid, text, date, time, time, text);
-- drop function if exists public.create_shift_modification_request(uuid, date, time, time, text);
-- drop index if exists public.uq_shift_modification_requests_pending_shift_id;
-- ※ shift_modification_requests: 旧ポリシー "smr: cast が自分の申請を作成/更新/削除"・
--   "smr: admin が同店舗を全操作"（FOR ALL）の復元は非推奨（review RPCを迂回できるため）。戻す場合のみ:
--   create policy "smr: cast が自分の申請を作成" on public.shift_modification_requests for insert with check (requested_by = auth.uid());
--   create policy "smr: cast が保留中の自分の申請を更新" on public.shift_modification_requests for update using (requested_by = auth.uid() and status = 'pending');
--   create policy "smr: cast が保留中の自分の申請を削除" on public.shift_modification_requests for delete using (requested_by = auth.uid() and status = 'pending');
--   create policy "smr: admin が同店舗を全操作" on public.shift_modification_requests for all using (shift_id in (select id from public.shifts where store_id = public.my_store_id()) and public.my_role() = 'admin');
--   grant all on public.shift_modification_requests to anon, authenticated;
-- drop trigger if exists shifts_a_guard_smr_delete on public.shifts;
-- drop trigger if exists shifts_a_guard_smr_status on public.shifts;
-- drop function if exists public.guard_linked_modification_request_delete();
-- drop function if exists public.guard_linked_modification_request_status();
-- ※ shifts: "shifts: cast が確定シフトに修正申請" ポリシーの復元は非推奨（create_shift_modification_requestを
--   迂回できるため）。戻す場合のみ:
--   create policy "shifts: cast が確定シフトに修正申請" on public.shifts for update
--     using (cast_id = auth.uid() and store_id = public.my_store_id() and status = 'confirmed')
--     with check (cast_id = auth.uid() and store_id = public.my_store_id() and status = 'modification_requested');
-- drop trigger if exists smr_notify_created on public.shift_modification_requests;
-- drop trigger if exists shifts_z_notify_delete on public.shifts;
-- drop trigger if exists shifts_z_notify_update on public.shifts;
-- drop trigger if exists shifts_a_guard_linked_delete on public.shifts;
-- drop trigger if exists shifts_a_guard_linked_status on public.shifts;
-- drop function if exists public.notify_modification_request_created();
-- drop function if exists public.notify_shift_delete();
-- drop function if exists public.notify_shift_update();
-- drop function if exists public.guard_linked_shift_delete();
-- drop function if exists public.guard_linked_shift_status();
-- ※ 旧自動承認トリガー(sync_vacant_slot_application_on_shift_confirm)は復元しない（承認RPCを迂回できるため）
-- ※ notifications: 旧INSERTポリシー(with check true)・anon/authenticatedの全権限の復元は非推奨。戻す場合のみ:
--    create policy "notif: insert は全員許可（サーバーサイドから）" on public.notifications for insert with check (true);
--    grant all on public.notifications to anon, authenticated;
-- ※※ 列を落とすと、created_by（どの経路がこの通知を作ったか）と push_sent_at（Web
--    Pushを送信済みかどうか）が失われる。created_by/push_sent_atに依存する
--    claim_pending_push_notifications・/api/push/dispatch は既に先に無効化されている前提だが、
--    列削除自体はデータ損失を伴う不可逆操作である点は、vacant_slot_applications側の列削除（本ブロック末尾）
--    と同程度に明確な警告が必要。null/null以外の希望時間帯を持つ申請と同様、created_by・push_sent_atに
--    意味のある値が入っている行が存在する場合は、事前にバックアップすること。
-- alter table public.notifications drop constraint notifications_link_allowed, drop column created_by, drop column push_sent_at;
-- drop function if exists public.create_notification_internal(uuid, text, text, text);
-- drop index if exists public.uq_vacant_slot_applications_shift_id;
-- drop function if exists public.vacant_slot_format_range(time, time, time);
-- drop function if exists public.vacant_slot_format_date(date);
-- alter publication supabase_realtime drop table public.vacant_slot_applications;
-- alter table public.vacant_slot_applications replica identity default;
-- drop function if exists public.create_vacant_slot(date, time, time, uuid, uuid, text, integer);
-- drop function if exists public.delete_vacant_slot(uuid);
-- drop function if exists public.set_vacant_slot_published(uuid, boolean);
-- drop function if exists public.review_vacant_slot_application(uuid, public.request_status);
-- drop function if exists public.cancel_vacant_slot_application(uuid);
-- drop function if exists public.apply_vacant_slot(uuid, time, time);
-- drop trigger if exists trg_check_vacant_slot_application_requested_time on public.vacant_slot_applications;
-- drop function if exists public.check_vacant_slot_application_requested_time();
-- drop function if exists public.vacant_slot_effective_date(date, time, time);
-- drop function if exists public.vacant_slot_ends_at(date, time, time);
-- drop policy if exists "vsa: cast が自分の保留中申請を削除" on public.vacant_slot_applications;
-- drop policy if exists "vsa: cast が公開中の空き枠へ申請を作成" on public.vacant_slot_applications;
-- drop policy if exists "vsa: cast が自分の申請を参照" on public.vacant_slot_applications;
-- ※ 旧ポリシー "vsa: cast が自分の申請を全操作"（FOR ALL）は自己承認できる脆弱なものなので、
--   復元しないことを推奨する。どうしても戻す場合のみ:
--   create policy "vsa: cast が自分の申請を全操作" on public.vacant_slot_applications for all using (cast_id = auth.uid());
-- alter table public.vacant_slot_applications drop column requested_start_time, drop column requested_end_time;
--   （列を落とすと部分時間の希望内容が失われる。null/null以外の申請が存在する場合は事前にバックアップすること）
