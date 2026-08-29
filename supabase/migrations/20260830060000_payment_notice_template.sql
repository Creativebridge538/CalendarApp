-- 支払通知書テンプレート機能: 店舗ごとに項目の並び順・表示ON/OFF・ラベル、
-- ヘッダー/フッターの自由記述を設定できるようにする（店舗設定＝雛形のデフォルト）
alter table public.store_settings
  add column notice_item_config jsonb not null default '[{"key":"sales_total","label":"売上合計","visible":true},{"key":"reward_rate","label":"報酬率","visible":true},{"key":"base_reward","label":"基本報酬","visible":true},{"key":"bonus","label":"ボーナス","visible":true},{"key":"deduction","label":"控除","visible":true},{"key":"custom_items","label":"追加項目","visible":true},{"key":"tax_breakdown","label":"うち消費税（10%内税）","visible":true},{"key":"daily_settled","label":"精算済み金額（参考）","visible":true}]'::jsonb,
  add column notice_header_text text,
  add column notice_footer_text text;

-- 既存店舗の notice_show_sales_total / notice_show_reward_rate の値を新しい設定に引き継ぐ
update public.store_settings
set notice_item_config = (
  select jsonb_agg(
    case
      when elem->>'key' = 'sales_total' then jsonb_set(elem, '{visible}', to_jsonb(notice_show_sales_total))
      when elem->>'key' = 'reward_rate' then jsonb_set(elem, '{visible}', to_jsonb(notice_show_reward_rate))
      else elem
    end
  )
  from jsonb_array_elements(notice_item_config) as elem
);

alter table public.store_settings
  drop column notice_show_sales_total,
  drop column notice_show_reward_rate;

-- 発行済み通知書（スナップショット）側にも同じ形式で項目設定・ヘッダー/フッターを保存する
-- （発行時点の店舗設定をそのままコピーし、以後は店舗側の設定変更の影響を受けない）
alter table public.payment_notices
  add column item_config jsonb not null default '[{"key":"sales_total","label":"売上合計","visible":true},{"key":"reward_rate","label":"報酬率","visible":true},{"key":"base_reward","label":"基本報酬","visible":true},{"key":"bonus","label":"ボーナス","visible":true},{"key":"deduction","label":"控除","visible":true},{"key":"custom_items","label":"追加項目","visible":true},{"key":"tax_breakdown","label":"うち消費税（10%内税）","visible":true},{"key":"daily_settled","label":"精算済み金額（参考）","visible":true}]'::jsonb,
  add column header_text text,
  add column footer_text text;

update public.payment_notices
set item_config = (
  select jsonb_agg(
    case
      when elem->>'key' = 'sales_total' then jsonb_set(elem, '{visible}', to_jsonb(show_sales_total))
      when elem->>'key' = 'reward_rate' then jsonb_set(elem, '{visible}', to_jsonb(show_reward_rate))
      else elem
    end
  )
  from jsonb_array_elements(item_config) as elem
);

alter table public.payment_notices
  drop column show_sales_total,
  drop column show_reward_rate;
