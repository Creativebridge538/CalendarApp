-- キャスト個人の「着せ替え」（アクセントカラー選択）。店舗全体のstore_settings.themeとは別軸の個人設定
alter table public.users add column accent_skin text not null default 'pink';
