# 権限モデル

この文書は「実際にDBが強制している権限」を記述する。アプリのUI上の表示制御はこれの上澄みでしかなく、最終的な権限境界は常にPostgreSQLのRow Level Security（RLS）とトリガーで決まる。

## ロール

`public.users.role` は `user_role` enum: `admin` / `cast` / `owner`（`store_signup_requests`関連の初期実装時は`cast`がまだ`casts`テーブルにいた歴史的経緯があるが、現在は`public.users`に統合済み）。

| ロール | 所属 | 想定用途 |
|---|---|---|
| `admin` | `store_id`あり | 店舗の管理者。自店舗内のシフト承認・売上入力・報酬計算・キャスト管理を行う |
| `cast` | `store_id`あり | キャスト本人。自分のシフト提出・自分の売上/報酬の閲覧を行う |
| `owner` | `store_id` なし | SaaS運営者。`/internal/*`配下から全店舗の一覧・利用停止/再開・新規申込の承認を行う。`isPlatformOwner()`（`src/lib/platform-owner.ts`）で判定 |

## 防御の三層構造

1. **ページ／APIルートでのサーバー側ガード**: 全ての管理者用ページ（Server Component）・管理者用APIルートは、`getCurrentUser()`でロールを取得し`role !== 'admin'`なら即`redirect`/`403`を返す。クライアント側の表示制御に依存していない
2. **RLS（Row Level Security）**: 上記1が万一バイパスされても、DBそのものが行単位でアクセスを拒否する。`supabase/migrations/`内の各`create policy`文が正
3. **列単位トリガー**: RLSは行単位の制御であり列単位の制御ではない。`public.users`の`role`/`store_id`/`reward_rate`/`is_active`のような権限に関わる列は、`lock_privileged_user_columns()`トリガー（`20260812060000_lock_privileged_user_columns.sql`）で「本人が自分の行を更新する場合のみ」変更前の値に強制的に戻す

## テーブルごとのアクセス範囲（要約）

`my_role()` / `my_store_id()` は `public.users`から自分のroleとstore_idを引くsecurity definer関数。

| テーブル | admin（自店舗） | cast |
|---|---|---|
| `stores` | 参照・作成・更新 | 参照不可（`users`経由でstore_idは分かるが`stores`行自体は取れない） |
| `store_settings` | 全操作 | 参照のみ |
| `users` | 自店舗ユーザーの参照・更新（role/store_id/reward_rate/is_active含む） | 自分の行のみ参照・更新（ただし上記4列はトリガーで無視される） |
| `rooms` / `areas` | 全操作 | 自店舗分を参照 |
| `shifts` | 自店舗を全操作 | 自分のシフトのみ参照・作成。更新は`status`が`draft`/`submitted`/`rejected`の間のみ、かつ更新後もその範囲内（＝キャストは直接`confirmed`にできない）。削除も同条件 |
| `shift_modification_requests` | 自店舗を全操作 | 自分の申請のみ参照・作成。更新・削除は`status='pending'`の間のみ、かつ更新後も`pending`のまま（＝自分で承認済みにできない） |
| `vacant_slots` | 全操作 | 公開済み(`is_published`)かつ自店舗分のみ参照 |
| `vacant_slot_applications` | 自店舗分を全操作 | 自分の申請のみ全操作 |
| `sales` | 自店舗を全操作 | 自分の売上のみ参照（作成・更新は不可、入力は管理者のみ） |
| `reward_calculations` | 自店舗を全操作 | 自分の明細のみ参照 |
| `notifications` | — | 自分宛のみ参照・既読更新 |
| `shift_checklist_items` | 全操作 | 自店舗の有効分のみ参照 |
| `push_subscriptions` | — | 本人の購読のみ全操作 |
| `store_signup_requests` | ポリシーなし（service_role専用） | ポリシーなし（service_role専用） |
| `cast_profile_fields` | 全操作 | 自店舗分を参照 |
| `store_google_drive_tokens` | 自店舗分を全操作 | 参照不可（別テーブルにして`store_settings`の全員参照ポリシーから隔離） |

## 既知の設計判断（意図的な制限であり不具合ではないもの）

- キャストは自分のシフトを直接`confirmed`にできない。確定は必ず管理者操作を経由する（`shifts`のUPDATE WITH CHECKで強制）
- キャストは自分の修正申請を自分で承認扱いにできない（同上）
- 同じ店舗・同じルームで時間帯が重なる`confirmed`シフトはDBのEXCLUDE制約（`shifts_no_double_booking`）でINSERT/UPDATE自体が失敗する。エラーコードは`23P01`

## 未対応・要検討

- `real_name` / `phone` は現状キャスト自身が変更できるRLS上の制限はない（UIには編集導線がないだけ）。実害は限定的だが、給与・本人確認に関わる列であれば`lock_privileged_user_columns()`に含める余地がある
- `store_id`は現状「1店舗＝1テナント」の前提。将来本部・複数店舗を持つ会社を扱うなら`organization_id`の追加を検討する
