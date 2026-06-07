# CalendarApp 仕様書

> 水商売系（キャバレー・ホステスバー等）向け 多店舗対応業務管理アプリ

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| BaaS | Supabase (Auth / DB / Realtime / Storage) |
| DB | PostgreSQL (Supabase内) |
| メール通知 | Resend |
| デプロイ | Vercel + Supabase Cloud |

---

## ロール

| ロール | 説明 |
|---|---|
| `admin` | 管理者。店舗設定・シフト確定・売上入力・報酬計算などすべての操作が可能 |
| `cast` | キャスト。シフト提出・確認・修正申請・明細確認が可能 |

> 管理者は1店舗または複数店舗を管理できる。キャストは1店舗に所属。

---

## 機能要件

### 1. 認証

- メール＋パスワードでログイン
- ロール（admin / cast）によって表示画面を切り替え
- パスワードリセット（メール送信）

---

### 2. 店舗管理（admin）

- 店舗の作成・編集・削除
- 店舗ごとの設定
  - シフト締切ルール（例：毎月25日 or 毎週金曜）
  - 締切後修正の承認制ON/OFF

---

### 3. キャスト管理（admin）

- キャスト一覧・詳細・編集
- プロフィール情報：名前・写真・連絡先・メモ
- 所属店舗の設定
- 報酬率の設定（個別設定、小数点対応）
- キャストアカウントの招待・無効化

---

### 4. ルーム管理（admin）

- 店舗内のルーム（個室・テーブル）の登録・編集・削除
- ルーム名・収容人数・備考

---

### 5. シフト提出（cast）

- 日付・開始時間・終了時間・備考を入力して提出
- 提出後は「提出済み」ステータスで一覧表示
- 締切前：自由に修正可能
- 締切後：修正申請フローへ（→ #7）

---

### 6. シフト確認・確定（admin）

- 提出されたシフトを一覧で確認（店舗・日付でフィルタ）
- ルーム被りチェック：同じルームに同時間帯のキャストが重複していないか自動検知・警告表示
- シフトを「確定」または「差し戻し」
- 確定後はキャストに通知

---

### 7. シフト修正申請（cast / admin）

**キャスト側**
- 締切後のシフトに対して修正申請を提出（変更内容・理由を入力）
- 申請ステータス（申請中 / 承認 / 却下）を確認可能

**管理者側**
- 修正申請一覧を確認
- 承認 → シフト内容を更新
- 却下 → 理由を入力してキャストに通知

---

### 8. 空き枠管理（admin / cast）

**管理者側**
- 空き枠（日付・時間・ルーム）を登録・公開

**キャスト側**
- 公開されている空き枠を一覧で確認
- 空き枠に対して申請
- 管理者が承認 → シフトとして登録

---

### 9. 売上入力（admin）

- キャスト・日付・売上金額を手入力
- 修正・削除可能
- 月次・日次で集計表示

---

### 10. 報酬計算（admin）

- 計算対象：キャスト・期間（月次）を選択してボタン押下で計算
- 計算式：`売上合計 × 報酬率 ＋ ボーナス − 控除`
- ボーナス・控除は手動入力
- 計算結果を保存（明細データとして確定）
- 確定後はキャストの明細画面に反映

---

### 11. 明細確認（cast）

- 月ごとの報酬明細を確認
  - 売上合計 / 報酬率 / 基本報酬 / ボーナス / 控除 / 支払総額
- PDF出力（将来対応、MVP外）

---

### 12. 通知

| トリガー | 通知先 | 方法 |
|---|---|---|
| シフト確定 | キャスト | アプリ内 |
| 修正申請の結果 | キャスト | アプリ内 |
| 修正申請が来た | 管理者 | アプリ内 |
| 空き枠申請が来た | 管理者 | アプリ内 |
| 空き枠申請の結果 | キャスト | アプリ内 |
| 報酬明細が確定 | キャスト | アプリ内 ＋ メール（任意） |

---

## 画面一覧

### キャスト側

| # | 画面名 | 概要 |
|---|---|---|
| C-01 | ログイン | メール＋パスワード認証 |
| C-02 | ダッシュボード | 今月のシフト一覧・報酬サマリー |
| C-03 | シフト提出 | 新規シフトの入力フォーム |
| C-04 | シフト一覧 | 提出済みシフトの確認・修正 |
| C-05 | シフト修正申請 | 締切後の修正申請フォーム |
| C-06 | 空き枠一覧・申請 | 公開中の空き枠を確認して申請 |
| C-07 | 報酬明細 | 月ごとの報酬明細確認 |
| C-08 | 通知一覧 | 未読・既読の通知一覧 |
| C-09 | プロフィール設定 | 連絡先・パスワード変更 |

### 管理者側

| # | 画面名 | 概要 |
|---|---|---|
| A-01 | ログイン | メール＋パスワード認証 |
| A-02 | ダッシュボード | 店舗サマリー・今日のシフト・未処理申請数 |
| A-03 | キャスト管理 | 一覧・詳細・招待・報酬率設定 |
| A-04 | ルーム管理 | ルームの登録・編集 |
| A-05 | シフト管理 | シフト一覧・確定・差し戻し・被りチェック |
| A-06 | 修正申請管理 | 申請一覧・承認・却下 |
| A-07 | 空き枠管理 | 空き枠登録・申請の承認 |
| A-08 | 売上入力 | キャスト別売上の手入力・集計 |
| A-09 | 報酬計算 | 月次報酬の計算・確定 |
| A-10 | 明細管理 | 確定済み明細の確認 |
| A-11 | 通知管理 | 通知の確認 |
| A-12 | 店舗設定 | 締切ルール・各種設定 |

---

## DB設計（概要）

### テーブル一覧

```
stores              店舗
store_settings      店舗設定（締切ルール等）
users               ユーザー（Supabase Auth連携）
casts               キャスト情報
rooms               ルーム（個室・テーブル）
shifts              シフト
shift_modification_requests  シフト修正申請
vacant_slots        空き枠
vacant_slot_applications     空き枠申請
sales               売上
reward_calculations  報酬計算結果
notifications       通知
```

### 主要テーブル定義

#### stores
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| name | text | 店舗名 |
| created_at | timestamptz | |

#### store_settings
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| store_id | uuid | FK: stores |
| deadline_type | enum | `monthly` / `weekly` |
| deadline_day | int | 月次=日付(1-31) / 週次=曜日(0-6) |
| require_approval_after_deadline | boolean | 締切後修正に承認が必要か |

#### users
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK (Supabase Auth uid) |
| email | text | |
| role | enum | `admin` / `cast` |
| store_id | uuid | FK: stores（castのみ） |

#### casts
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK: users |
| store_id | uuid | FK: stores |
| display_name | text | 源氏名 |
| real_name | text | 本名 |
| photo_url | text | |
| reward_rate | numeric(5,4) | 報酬率（例: 0.4500） |
| is_active | boolean | |

#### rooms
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| store_id | uuid | FK: stores |
| name | text | ルーム名 |
| capacity | int | 収容人数 |

#### shifts
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| cast_id | uuid | FK: casts |
| store_id | uuid | FK: stores |
| room_id | uuid | FK: rooms（nullable） |
| date | date | |
| start_time | time | |
| end_time | time | |
| status | enum | `draft` / `submitted` / `confirmed` / `rejected` |
| notes | text | |
| confirmed_at | timestamptz | |

#### shift_modification_requests
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| shift_id | uuid | FK: shifts |
| requested_by | uuid | FK: users |
| new_date | date | |
| new_start_time | time | |
| new_end_time | time | |
| reason | text | |
| status | enum | `pending` / `approved` / `rejected` |
| reviewed_by | uuid | FK: users |
| reviewed_at | timestamptz | |

#### sales
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| cast_id | uuid | FK: casts |
| store_id | uuid | FK: stores |
| date | date | |
| amount | numeric(12,0) | 売上金額（円） |

#### reward_calculations
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| cast_id | uuid | FK: casts |
| store_id | uuid | FK: stores |
| period_year | int | 対象年 |
| period_month | int | 対象月 |
| sales_total | numeric(12,0) | 売上合計 |
| reward_rate | numeric(5,4) | 適用報酬率 |
| base_reward | numeric(12,0) | 基本報酬 |
| bonus | numeric(12,0) | ボーナス |
| deduction | numeric(12,0) | 控除 |
| total_reward | numeric(12,0) | 支払総額 |
| calculated_at | timestamptz | |
| is_finalized | boolean | 確定済みフラグ |

#### notifications
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK: users |
| title | text | |
| body | text | |
| link | text | 関連画面へのパス |
| read_at | timestamptz | nullable（未読管理） |
| created_at | timestamptz | |

---

## 機能優先度

**優先度 高（まず動かす）**
- 認証（ログイン・ロール分け）
- 店舗・キャスト・ルーム管理
- シフト提出・一覧・管理者確定
- ルーム被りチェック
- 締切ルール設定

**優先度 中（次に作る）**
- シフト修正申請
- 空き枠管理

**優先度 低（後回しOK）**
- 売上入力・報酬計算・明細
- 通知機能
