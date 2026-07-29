-- フォントを配色スキンから独立して選べるように分離（着せ替え = 色、着せ替えフォント = 書体）
alter table public.users add column accent_font text not null default 'default';
