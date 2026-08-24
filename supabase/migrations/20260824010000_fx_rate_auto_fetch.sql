alter table public.store_settings
  add column usd_jpy_auto_fetch boolean not null default true,
  add column usd_jpy_adjustment numeric not null default 0;
