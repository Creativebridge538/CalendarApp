-- 支払通知書の「為替を表示する／しない」設定を追加する。
--
-- 既存の notice_item_config（売上合計・報酬率・基本報酬等8項目の表示ON/OFF設定）と同じ設計を踏襲する:
--   store_settings.notice_fx_visible は店舗の既定設定（今後発行する通知書に適用される）。
--   payment_notices.fx_visible は発行時点の設定値をそのままスナップショットとして保存する列で、
--   発行後の店舗設定変更の影響を受けない（item_config / header_text / footer_text と同じ扱い）。
--
-- 両列とも not null default true のため、このmigration適用時点で既存の発行済み通知書
-- （payment_notices の既存行）は自動的に true が設定される。これは「店舗設定が存在しなかった
-- 旧コードでは、為替データがあれば常に為替列を表示していた」という従来の唯一の挙動と一致する
-- （表示条件は「設定がtrue」かつ「為替データが存在する行がある」のANDになるため、
-- 旧挙動＝データの有無だけで決まっていた状態と完全に一致する）。これにより、既存の発行済み
-- 通知書の見た目はこのmigration適用だけでは一切変化しない。
--
-- 換算・報酬・合計・税・日払い・追加項目の計算列やデータは一切変更しない（列の追加のみ）。
begin;

alter table public.store_settings
  add column if not exists notice_fx_visible boolean not null default true;

alter table public.payment_notices
  add column if not exists fx_visible boolean not null default true;

commit;
