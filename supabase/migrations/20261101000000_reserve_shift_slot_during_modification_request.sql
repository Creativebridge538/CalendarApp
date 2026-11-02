-- 修正申請（shift_modification_requests）が承認・却下のいずれかで解決されるまで、
-- 元の確定シフトの部屋・時間帯を「予約済み」として扱う（capacity判定に含める）。
--
-- 背景（カレンダー開発台帳111・112節。Rayzy DEVでの検証で判明）：check_shift_double_booking()は
-- status='confirmed'の行だけを重複カウントの対象にしていた。このためシフトがmodification_requested
-- になっている間、元の部屋・時間帯は他キャストの確定シフトから見て「空き」に見えてしまい、別キャストの
-- 確定シフトがそこへ入り込めた。この状態になると、保留中の申請は却下（元の時間に戻す）・承認（新しい
-- 時間へ移す）のどちらも容量超過エラーで失敗し、通常の画面操作では解消できなくなる不具合があった。
--
-- 対応：重複カウント対象のステータスを 'confirmed' だけでなく 'modification_requested' も含める。
-- modification_requested中のシフトのdate/start_time/end_time/room_idは、申請が承認されるまで
-- 元の値のまま変わらない（希望内容はshift_modification_requests.new_*に別途保持されるだけで、
-- shiftsへは反映されない）。したがって、この変更は「元の枠だけを予約し、申請しただけでは
-- 希望先を予約しない」という仕様のまま実現できる（変更先は、承認が実行されて初めて予約される）。
--
-- 影響確認（カレンダー開発台帳112-b, 113節に詳細記録）：
--  - 承認時の新しい時間帯の重複判定（修正申請の承認・空き枠の承認はいずれも本関数を経由する）も、
--    他のmodification_requested行の「元の枠」と衝突する場合は失敗するようになる。従来はconfirmed行
--    との衝突しか見ておらず、この点は台帳112節時点の記録を訂正する対象。
--  - 却下（元の時間へ戻すUPDATE）・承認（新しい時間へのUPDATE）とも、対象行自身は
--    `shx.id <> NEW.id` により従来通り重複カウントから除外されるため、自己衝突は発生しない。
--  - 空き枠機能（review_vacant_slot_application）が承認時に行う明示的な事前チェック
--    （「同じルームの確定シフトとの重複」。status='confirmed'のみを見る別のSQL）は、本関数とは
--    別の問い合わせのため本変更では広がらない。ただし、その直後に実行される
--    `update shifts set status = 'confirmed' ...`は本トリガーを通るため、modification_requested
--    中の元の枠と衝突する場合は、このUPDATEの時点でshifts_no_double_bookingエラーにより安全に
--    失敗する（事前チェックとは別経路の保護として機能し、既存の「事前チェック＋トリガー」という
--    二重防御の構成は変えない）。
--  - 空き枠の取消（cancel_vacant_slot_application）はshifts.statusをconfirmedにする操作を含まない
--    ため、本トリガーを経由せず無関係。
--  - 空き枠の表示・応募可否（vacant_slots.is_published・capacity/approved_count）は、もともと既存
--    シフトとの重複有無に関わらず判定されており、本変更はこの既存の仕様（申請・応募の時点ではわから
--    ず、承認時になって重複が判明することがある）を変えない。新たな食い違いを作るものではない。
--  - 同時操作：既存のトリガーはUPDATE対象行の暗黙ロックとトランザクション内のCOUNT(*)に依存する。
--    本変更はカウント対象ステータスの範囲を広げるだけで、同時実行時の保証レベル（トランザクション
--    分離に依存する既存の限界）自体は変えない。新たな排他制御を追加するものではない。
--
-- search_pathについて：この関数は20260819070000で作成された時点ではsearch_path未指定だったが、
-- 20260919000000のALTER FUNCTIONでsearch_path=publicを後付けしている。CREATE OR REPLACE FUNCTIONが
-- 既存のSET設定を自動的に引き継ぐ保証はないため、推測に頼らず本migrationでも明示的に
-- `set search_path = public`を指定する。SECURITY属性（prosecdef=false。つまりSECURITY INVOKERの
-- まま）・権限（この関数に対する個別のGRANT/REVOKEは元々存在しない。トリガー関数として呼び出される
-- ため不要。CREATE OR REPLACE FUNCTIONは所有者・権限を変更しないというPostgresの既定動作により、
-- この点は変わらない）は変更しない。

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
