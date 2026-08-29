-- 売上入力で、ボーナス・控除と同じように、項目名付きの追加金額を複数登録できるようにする
-- （例: 指名料 5000円、ドリンクバック 2000円 など）。マイナス値で控除としても使える
alter table public.sales
  add column custom_items jsonb not null default '[]'::jsonb;
