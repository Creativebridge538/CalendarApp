-- プラットフォームを「固定単価を使う」設定にしていても、売上（sales_amount）は常に
-- 計算式モードの換算結果を使いたいという要望に対応するため、女子給計算のベースとなる
-- amount とは別に売上専用の金額を持てるようにする。
-- null の行（過去データ）は amount をそのまま売上として扱うフォールバックで対応する
alter table public.sales add column sales_amount numeric(12,0);
