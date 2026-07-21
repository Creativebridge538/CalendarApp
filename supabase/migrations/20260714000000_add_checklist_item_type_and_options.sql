-- 確認項目にタイプ(チェックボックス/プルダウン)と選択肢を追加
-- item_type: 'checkbox' | 'select'
alter table shift_checklist_items
  add column item_type text not null default 'checkbox',
  add column options    text[] not null default '{}';

-- シフトの回答を { 項目ID: true | "選択値" } の形で保持するよう変更
-- (uuid配列だとプルダウンの選択値を持てないため)
alter table shifts drop column checklist_item_ids;
alter table shifts add column checklist_answers jsonb not null default '{}';
