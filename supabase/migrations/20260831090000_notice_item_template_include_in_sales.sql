-- 追加項目テンプレートごとに、その項目の金額を売上合計にも反映するかどうかを設定できるようにする
-- （デフォルトはfalse＝これまで通り売上には影響しない）
alter table public.notice_item_templates add column include_in_sales boolean not null default false;
