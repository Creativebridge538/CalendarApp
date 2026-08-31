# ShiftMate

キャバクラ／ラウンジ等の店舗向け、シフト・売上・報酬管理SaaS。Next.js（App Router）+ Supabase（Postgres / Auth / RLS）構成。

管理者（`admin`）が店舗のシフト・売上・キャストを管理し、キャスト（`cast`）が自分のシフト提出・売上確認・報酬確認を行う。`owner`ロールは店舗をまたいで全体を管理するSaaS運営者専用ロール。

詳細ドキュメントは `docs/` を参照:

- [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) — ロール・RLS（Row Level Security）による権限モデル
- [`docs/DATABASE.md`](docs/DATABASE.md) — スキーマ概要・マイグレーション運用フロー
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — 案件ごとのVercel/Supabase払い出し・デプロイ手順
- [`docs/SECURITY.md`](docs/SECURITY.md) — セキュリティ対策の状況と既知の残課題

## 技術スタック

- Next.js 16 (App Router, Turbopack)
- Supabase（Postgres, Auth via `@supabase/ssr`, RLS）
- Tailwind CSS v4 + shadcn/ui（base-ui ベース）
- Vitest（RLSセキュリティテスト）
- Web Push（PWA通知）, Resend（メール, 任意）

## 開発環境セットアップ

```bash
pnpm install
supabase start          # ローカルSupabaseを起動（Docker必須）
cp .env.local.example .env.local  # 値は `supabase status` の出力から埋める
pnpm dev
```

必要な環境変数:

| 変数名 | 用途 | 必須 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトURL | ○ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ○ |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー側API（admin操作）用 | ○ |
| `SUPABASE_DB_PASSWORD` | `supabase db push --linked` 実行時 | マイグレーション適用時のみ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push通知 | ○（通知機能を使う場合） |
| `RESEND_API_KEY` | 報酬確定通知メール送信 | 任意（未設定時は送信をスキップ） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 支払通知書PDFのGoogle Drive保存機能（OAuth） | 任意（未設定時はGoogle Drive連携ボタンがエラーを返す） |

## よく使うコマンド

```bash
pnpm dev                 # 開発サーバー
pnpm build                # 本番ビルド（型チェック含む）
pnpm lint                 # ESLint
pnpm exec tsc --noEmit    # 型チェックのみ
pnpm test:security         # RLSセキュリティテスト（要 supabase start）
```

## マイグレーション運用の要点

- 既に適用済みのマイグレーションファイルは絶対に編集しない。変更が必要なら新しいタイムスタンプ付きファイルを追加する。
- ローカル → 型生成 → 案件ごとのリモートSupabaseへ、の順で適用する。詳細は [`docs/DATABASE.md`](docs/DATABASE.md)。
