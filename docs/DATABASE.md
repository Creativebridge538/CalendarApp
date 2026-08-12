# データベース

Supabase（Postgres）。スキーマの正はコードの説明文ではなく `supabase/migrations/*.sql` そのもの。この文書は迷ったときの地図として使う。

## テーブル一覧と役割

| テーブル | 役割 |
|---|---|
| `stores` | 店舗（テナント）本体 |
| `store_settings` | 店舗ごとの設定（締切ルール、ロケーションモード、テーマ、為替レート、プラットフォーム設定など） |
| `users` | 認証ユーザーのプロフィール。`auth.users`と1:1（`id`が同じ）。admin/cast/owner共通 |
| `areas` / `rooms` | 場所の単位。店舗の`location_mode`設定によりどちらを使うか（両方・片方・なし）が変わる |
| `shifts` | シフト本体。`status`は`draft`→`submitted`→`confirmed`/`rejected`/`modification_requested` |
| `shift_modification_requests` | 確定後のシフト変更申請 |
| `vacant_slots` / `vacant_slot_applications` | 管理者が公開する空き枠と、キャストからの応募 |
| `sales` | 売上（プラットフォーム別・手入力）。ボーナス/控除、稼働時間もここに持つ |
| `reward_calculations` | 月次報酬計算結果。確定(`is_finalized`)後は通常編集しない運用 |
| `notifications` | アプリ内通知 |
| `shift_checklist_items` | シフト提出時の確認項目（店舗ごとにカスタム） |
| `push_subscriptions` | Web Push購読情報 |
| `cast_profile_fields` | キャストプロフィールのカスタム項目定義 |
| `store_signup_requests` | セルフサーブ新規店舗申込（承認制。RLSポリシーなし＝service_role専用） |

## 重要な制約

- **ダブルブッキング防止**: `shifts_no_double_booking`（GiST EXCLUDE制約, `btree_gist`拡張使用）。同じ`store_id`+`room_id`で時間帯が重なる`status='confirmed'`シフトはINSERT/UPDATEレベルで拒否される。日付をまたぐシフト（`end_time <= start_time`＝翌日跨ぎとして正規化）も正しく判定する
- **`shift_status`はenum型**（`shift_status`）。値を追加する場合は`ALTER TYPE ... ADD VALUE`を使い、既存のenum定義文自体は編集しない（Postgresの制約上、型の値追加は取り消せないトランザクション制限があることに注意）

## マイグレーション運用フロー

1. **既に適用済みのファイルは絶対に編集しない**。変更が必要なら新しいタイムスタンプ付きファイル（`YYYYMMDDHHMMSS_description.sql`）を追加する
2. ローカルに適用して検証:
   ```bash
   supabase db push --local --yes
   ```
3. 型を再生成してコピー:
   ```bash
   supabase gen types typescript --local > /tmp/db_types.ts
   cp /tmp/db_types.ts src/lib/supabase/database.types.ts
   ```
4. 動作確認（`pnpm test:security`含む）が済んでから、案件ごとのリモートSupabaseへ適用:
   ```bash
   SUPABASE_DB_PASSWORD="$SUPABASE_DB_PASSWORD" supabase db push --linked --yes
   ```
5. 複数の案件（別Supabaseプロジェクト）を運用している場合、`supabase link --project-ref <ref>`で対象を切り替えてから4を繰り返す。**1つの環境に適用したら全環境に適用したことにはならない**

## 制約を追加するマイグレーションを書くときの注意

既存データと矛盾する制約（UNIQUE, EXCLUDE, CHECKなど）を追加する場合、適用前に必ず対象データで矛盾がないか確認すること。矛盾があるとマイグレーション自体が失敗し、後続のマイグレーションが詰まる。ローカルでのみ矛盾するテスト用データは業務に影響しないため、データ側を先に是正してから適用してよい。

## ローカルDBへの直接アクセス

```bash
docker exec -i supabase_db_<プロジェクト名> psql -U postgres -d postgres
```

`supabase db query --local --file <path>`でも実行できるが、出力フォーマットの制御が弱いため、複雑なクエリの結果確認は上記のpsql直接実行が確実。
