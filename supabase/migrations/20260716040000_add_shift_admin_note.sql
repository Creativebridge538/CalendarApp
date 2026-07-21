-- シフト確定/差し戻し時の管理者メモ（管理者のみ閲覧、キャストには非表示）
alter table shifts add column admin_note text;
