
-- castsテーブルをusersに統合
-- キャストは必ずログインアカウントを持つ前提（招待フロー不使用）

-- 1. usersにキャストプロフィール列を追加
ALTER TABLE public.users
  ADD COLUMN display_name text,
  ADD COLUMN real_name    text,
  ADD COLUMN photo_url    text,
  ADD COLUMN phone        text,
  ADD COLUMN notes        text,
  ADD COLUMN reward_rate  numeric(5,4) not null default 0.4000,
  ADD COLUMN is_active    boolean not null default true;

-- 2. 既存データを移行（user_idが紐づいているcastsレコードのみ）
UPDATE public.users u
SET
  display_name = c.display_name,
  real_name    = c.real_name,
  photo_url    = c.photo_url,
  phone        = c.phone,
  notes        = c.notes,
  reward_rate  = c.reward_rate,
  is_active    = c.is_active
FROM casts c
WHERE c.user_id = u.id;

-- 3. cast_id FK の付け替え（casts.id → users.id）
ALTER TABLE shifts                  DROP CONSTRAINT shifts_cast_id_fkey;
ALTER TABLE sales                   DROP CONSTRAINT sales_cast_id_fkey;
ALTER TABLE vacant_slot_applications DROP CONSTRAINT vacant_slot_applications_cast_id_fkey;
ALTER TABLE reward_calculations     DROP CONSTRAINT reward_calculations_cast_id_fkey;

ALTER TABLE shifts ADD CONSTRAINT shifts_cast_id_fkey
  FOREIGN KEY (cast_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE sales ADD CONSTRAINT sales_cast_id_fkey
  FOREIGN KEY (cast_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE vacant_slot_applications ADD CONSTRAINT vacant_slot_applications_cast_id_fkey
  FOREIGN KEY (cast_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE reward_calculations ADD CONSTRAINT reward_calculations_cast_id_fkey
  FOREIGN KEY (cast_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 4. casts参照ポリシーを先に削除してから castsテーブル削除
DROP POLICY IF EXISTS "shifts: cast が自分のシフト参照"    ON shifts;
DROP POLICY IF EXISTS "shifts: cast が自分のシフト作成"    ON shifts;
DROP POLICY IF EXISTS "shifts: cast が未確定シフト更新"    ON shifts;
DROP POLICY IF EXISTS "rooms: cast が同店舗参照"           ON rooms;
DROP POLICY IF EXISTS "vacant_slots: cast が公開分を参照"  ON vacant_slots;
DROP POLICY IF EXISTS "vsa: cast が自分の申請を全操作"     ON vacant_slot_applications;
DROP POLICY IF EXISTS "sales: cast が自分の売上参照"       ON sales;
DROP POLICY IF EXISTS "reward: cast が自分の明細参照"      ON reward_calculations;

DROP TABLE casts;

-- 5. RLSポリシー更新（直接 users.id 参照に簡略化）

CREATE POLICY "shifts: cast が自分のシフト参照" ON shifts FOR SELECT
  USING (cast_id = auth.uid());
CREATE POLICY "shifts: cast が自分のシフト作成" ON shifts FOR INSERT
  WITH CHECK (cast_id = auth.uid());
CREATE POLICY "shifts: cast が未確定シフト更新" ON shifts FOR UPDATE
  USING (cast_id = auth.uid() AND status IN ('draft', 'submitted'));

CREATE POLICY "rooms: cast が同店舗参照" ON rooms FOR SELECT
  USING (store_id = my_store_id());

CREATE POLICY "vacant_slots: cast が公開分を参照" ON vacant_slots FOR SELECT
  USING (is_published = true AND store_id = my_store_id());

CREATE POLICY "vsa: cast が自分の申請を全操作" ON vacant_slot_applications FOR ALL
  USING (cast_id = auth.uid());

CREATE POLICY "sales: cast が自分の売上参照" ON sales FOR SELECT
  USING (cast_id = auth.uid());

CREATE POLICY "reward: cast が自分の明細参照" ON reward_calculations FOR SELECT
  USING (cast_id = auth.uid());
