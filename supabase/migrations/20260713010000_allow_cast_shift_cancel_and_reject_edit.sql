-- 却下(rejected)されたシフトもキャストが再編集・削除できるようにする
drop policy "shifts: cast が未確定シフト更新" on shifts;
create policy "shifts: cast が未確定シフト更新" on shifts for update
  using (cast_id = auth.uid() and status in ('draft', 'submitted', 'rejected'));

-- キャストが未確定シフトを取消（削除）できるようにする
create policy "shifts: cast が未確定シフト削除" on shifts for delete
  using (cast_id = auth.uid() and status in ('draft', 'submitted', 'rejected'));
