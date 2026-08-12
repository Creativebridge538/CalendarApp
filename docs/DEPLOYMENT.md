# デプロイ・案件ごとの環境構築

このリポジトリは1つだが、案件（会社）ごとに**独立したVercelプロジェクト＋独立したSupabaseプロジェクト**を払い出す運用にしている。理由は[`docs/SECURITY.md`](SECURITY.md)を参照。同一リポジトリのコードを複数の物理的に分離したインフラにデプロイする形なので、「どの環境に何を適用したか」を必ず把握すること。

## 新規案件を立ち上げる手順

1. **Supabaseプロジェクトを新規作成**（案件専用）
2. マイグレーションを適用:
   ```bash
   supabase link --project-ref <新しいproject-ref>
   SUPABASE_DB_PASSWORD="<新プロジェクトのDBパスワード>" supabase db push --linked --yes
   ```
   `supabase/migrations/`配下の全ファイルが最初から適用される
3. Supabase Auth設定: メール確認の要否、リダイレクトURL（`<デプロイ先ドメイン>/auth/callback`）を設定
4. Storageバケット作成を確認（`store-assets`, `cast-avatars`など。マイグレーション内で作成されるものはそれで足りるが、Studio上で存在確認すること）
5. **Vercelプロジェクトを新規作成**（案件専用、このリポジトリを紐付け）
6. Vercel側環境変数を設定（[`README.md`](../README.md)の環境変数表を参照。値は手順1のSupabaseプロジェクトから取得）
7. 初回admin/ownerアカウントの作成: `supabase/seed.cjs`相当のロジックを参考に、`service_role`で`auth.admin.createUser` → `public.users`の`role`/`store_id`を設定する（本番データを直接シード投入しないよう注意。テスト用ではなく実データなら、店舗作成〜管理者作成は管理画面のサインアップフロー（`/apply`→`store_signup_requests`→owner承認）を使うのが安全）
8. デプロイ後、`pnpm test:security`をこの新環境に向けて実行し、RLSが機能していることを確認する（`TEST_SUPABASE_URL`等の環境変数で対象を切り替えられる。**本番データが入った環境に対して実行すると`tests/rls/security.test.ts`が作成するテスト用の店舗・ユーザーが紛れ込むので、実行は原則ローカル/検証用プロジェクト限定とする**）

## 既存案件へのマイグレーション適用

[`docs/DATABASE.md`](DATABASE.md)のマイグレーション運用フローを参照。`supabase link`で対象プロジェクトを切り替えてから`db push --linked`を実行する。

## 引き継ぎ時に必要な情報

- 各案件のVercelプロジェクト名／Supabase project ref の対応表（このリポジトリには含めない。社内の秘匿情報として別管理する）
- 各案件のSupabase `service_role` key, DBパスワード
- 各案件のVAPID鍵ペア（Web Push用、案件ごとに別鍵を使っている場合）
