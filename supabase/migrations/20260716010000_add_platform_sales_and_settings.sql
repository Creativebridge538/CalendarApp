-- 為替レート・プラットフォーム換算設定・支払通知書ロゴ
alter table store_settings
  add column usd_jpy_rate      numeric(10,4),
  add column platform_settings jsonb not null default '{}',
  add column logo_url          text;

-- 売上のプラットフォーム別入力・日払い上書き対応
-- platform: 'manual' | 'stripchat' | 'fc2' | 'dxlive'
alter table sales
  add column platform             text not null default 'manual',
  add column raw_units            numeric(12,2),
  add column usd_amount           numeric(12,2),
  add column fx_rate_snapshot     numeric(10,4),
  add column is_daily_payment     boolean not null default false,
  add column rate_override        numeric(12,4),
  add column reward_rate_override numeric(5,4);
