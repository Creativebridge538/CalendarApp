-- 手入力売上に項目名を付ける機能は不要になったため削除する
-- （代わりに custom_items で項目名付きの追加金額を複数登録できる）
alter table public.sales
  drop column manual_label;
