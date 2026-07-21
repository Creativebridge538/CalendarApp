-- shift_modification_requests: cast側の "ALL" ポリシーは status を問わず自分の行を
-- 更新・削除できてしまう（例えば管理者が却下/承認した後でも status を書き換えられる）。
-- アプリのUIは cast 側で INSERT しか行わないため、実害は「直接APIを叩いて自分の申請を
-- 承認済み扱いにし管理者のキューから隠す」程度に限定されるが、念のため保留中のみに絞る。
drop policy if exists "smr: cast が自分の申請を全操作" on public.shift_modification_requests;

create policy "smr: cast が自分の申請を参照"
  on public.shift_modification_requests for select
  using (requested_by = auth.uid());

create policy "smr: cast が自分の申請を作成"
  on public.shift_modification_requests for insert
  with check (requested_by = auth.uid());

create policy "smr: cast が保留中の自分の申請を更新"
  on public.shift_modification_requests for update
  using (requested_by = auth.uid() and status = 'pending');

create policy "smr: cast が保留中の自分の申請を削除"
  on public.shift_modification_requests for delete
  using (requested_by = auth.uid() and status = 'pending');
