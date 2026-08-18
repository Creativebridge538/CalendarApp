-- キャストの確定済みシフトへの修正申請は、shift_modification_requestsへの
-- INSERTは成功する一方、shifts.status を 'modification_requested' に変更する
-- UPDATEは既存のRLSポリシー（status in ('draft','submitted','rejected')のみ許可）に
-- 阻まれて0件更新のまま静かに失敗し、シフトは「確定」のまま変わっていなかった。
-- 確定シフトから「修正依頼中」への遷移だけを許可する別ポリシーを追加する。
create policy "shifts: cast が確定シフトに修正申請" on shifts for update
  using (cast_id = auth.uid() and store_id = my_store_id() and status = 'confirmed')
  with check (cast_id = auth.uid() and store_id = my_store_id() and status = 'modification_requested');
