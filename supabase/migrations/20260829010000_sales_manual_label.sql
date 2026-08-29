-- 売上入力で「手入力」の行に、項目名を自由に設定できるようにする
-- （例: 指名料、ドリンクバックなど）。未設定なら従来通り「手入力」と表示する
alter table public.sales
  add column manual_label text;
