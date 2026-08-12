-- castによるshifts更新ポリシーはcast_idとstatusしか見ておらず、store_idを縛っていなかった。
-- そのため理論上、キャストが自分のシフト行のstore_idを直接APIで書き換え、
-- 別店舗のデータとして紐付け直すことができてしまう(閲覧・奪取はできないが整合性が壊れる)。
-- store_idも変更前後で自店舗のままであることを明示的に要求する。
drop policy "shifts: cast が未確定シフト更新" on shifts;
create policy "shifts: cast が未確定シフト更新" on shifts for update
  using (cast_id = auth.uid() and store_id = my_store_id() and status in ('draft', 'submitted', 'rejected'));
