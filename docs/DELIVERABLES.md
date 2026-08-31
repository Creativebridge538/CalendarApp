# 納品物一覧

<div class="doc-meta">発行日: 2026年8月31日　／　株式会社Rayzy</div>

**件名**: 業務管理システム「ShiftMate」（シフト・報酬・キャスト管理）開発 一式

**対象範囲**: ソースコード／動作環境／仕様書／説明書

---

## ソースコード

### GitHub リポジトリ

本システムのソースコード一式（Next.js アプリケーション + Supabase マイグレーション）を GitHub リポジトリで納品します。

- 自社運用環境: `rayzyfurukawa/CalendarApp`（main ブランチ、最新コミット `8b0e41e`・2026年8月31日時点）
- クライアント向け環境: `eve8008/CalendarApp`（専用リポジトリとして払い出し済み）

> ※クライアント向けリポジトリは現在アクセスできない状態を確認しています。別途状況をご確認ください。

## 動作環境

### 技術構成

Next.js（App Router）+ TypeScript、Tailwind CSS + shadcn/ui、Supabase（PostgreSQL / Auth / Realtime / Storage）

- メール送信: Resend
- Web Push 通知: VAPID + Service Worker
- Google Drive 連携: OAuth 2.0

### ホスティング

Vercel（Next.js アプリケーション）+ Supabase Cloud（データベース・認証）

- 本番URL（自社運用環境）: https://calendar-app-one-sage.vercel.app
- Vercel プロジェクト・Supabase プロジェクトの詳細情報、管理者アカウントは別途共有いたします。

## 仕様書

### SPEC

プロダクト概要・技術スタック・データベース設計・主要機能をまとめた開発者向け仕様書

`docs/SPEC.md`（Markdown）／ `docs/SPEC.pdf`

## 説明書

### GUIDE

管理者側・キャスト側それぞれの画面操作方法を、実画面のスクリーンショット付きで解説したエンドユーザー向け説明書

`docs/GUIDE.md`（Markdown）／ `docs/GUIDE.pdf`

---

## 備考

- 仕様書・説明書は、機能追加・仕様変更に応じて随時更新いたします。最新版は GitHub リポジトリの `docs/` 配下をご参照ください。
- サーバー・各種 SaaS の利用料（Supabase、Vercel、Resend 等）は別途実費となります。
- 保守・運用サポートについては別途ご相談ください。

※ご不明な点がございましたら、ご遠慮なくお問い合わせください
