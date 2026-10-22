import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// supabase/migrations/20260919000000_add_vacant_slot_application_requested_time.sql の静的監査。
// DBへは一切接続しない。ファイルのテキストだけを検査する（実行はしない）。
const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260919000000_add_vacant_slot_application_requested_time.sql', import.meta.url)
)
const sql = readFileSync(MIGRATION_PATH, 'utf8')

// ヘッダーの説明文中にも「PREFLIGHT」という語が言及として登場するため、実際のセクション見出し行という
// 一意な文字列で位置を特定する（単なる'PREFLIGHT'検索だと、それより前にある言及にマッチしてしまう）
const PREFLIGHT_SECTION_MARKER = '-- PREFLIGHT: 本migrationが前提とする既存オブジェクトの検査と、既存データの重複チェック。'

/** `create or replace function public.<name>(...) ... $$;` の1関数分のテキストを切り出す */
function extractFunctionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  if (start === -1) throw new Error(`function not found in migration: ${name}`)
  const end = sql.indexOf('\n$$;\n', start)
  if (end === -1) throw new Error(`function body terminator ($$;) not found for: ${name}`)
  return sql.slice(start, end)
}

describe('PREFLIGHT: 既存オブジェクトの検査がDDLより前にある', () => {
  const preflightIdx = sql.indexOf(PREFLIGHT_SECTION_MARKER)
  const firstAlterTableIdx = sql.indexOf('alter table public.vacant_slot_applications\n  add column requested_start_time')

  it('PREFLIGHTブロックが存在し、最初のDDL（列追加）より前にある', () => {
    expect(preflightIdx).toBeGreaterThan(-1)
    expect(firstAlterTableIdx).toBeGreaterThan(-1)
    expect(preflightIdx).toBeLessThan(firstAlterTableIdx)
  })

  it('前提とする6テーブル・4関数・2型の存在確認が、DDLより前でto_regclass/to_regprocedure/to_regtypeにより行われる', () => {
    const preflight = sql.slice(preflightIdx, firstAlterTableIdx)
    for (const t of ['notifications', 'vacant_slots', 'vacant_slot_applications', 'shifts', 'shift_modification_requests', 'users']) {
      expect(preflight).toContain(`to_regclass('public.${t}')`)
    }
    for (const fn of ["check_shift_double_booking()", "sync_vacant_slot_approved_count(uuid)", 'my_role()', 'my_store_id()']) {
      expect(preflight).toContain(`to_regprocedure('public.${fn}')`)
    }
    for (const ty of ['request_status', 'shift_status']) {
      expect(preflight).toContain(`to_regtype('public.${ty}')`)
    }
  })

  it('ALTER POLICY対象の既存notificationsポリシー3件の存在確認がある', () => {
    const preflight = sql.slice(preflightIdx, firstAlterTableIdx)
    for (const policy of ['notif: 自分の通知を参照', 'notif: admin が同店舗ユーザー宛の通知を参照', 'notif: 自分の通知を更新（既読）']) {
      expect(preflight).toContain(`policyname = '${policy}'`)
    }
  })

  it('不足時は具体的なオブジェクト名を含む例外を出し、後続のDDLへ進まない', () => {
    const preflight = sql.slice(preflightIdx, firstAlterTableIdx)
    expect(preflight).toMatch(/raise exception.*不足.*array_to_string\(v_missing/)
  })

  it('重複データチェック（vacant_slot_applications.shift_id / shift_modification_requestsのpending shift_id）もDDLより前にある', () => {
    const preflight = sql.slice(preflightIdx, firstAlterTableIdx)
    expect(preflight).toContain('vacant_slot_applications.shift_id に重複があるため')
    expect(preflight).toContain('shift_modification_requests に同じshiftへのpending申請の重複があるため')
  })

  it('環境固有の値（プロジェクトref・secret等）らしき文字列を埋め込んでいない', () => {
    const preflight = sql.slice(preflightIdx, firstAlterTableIdx)
    expect(preflight).not.toMatch(/service_role_key|SUPABASE_URL|supabase\.co|eyJ[A-Za-z0-9_-]{10,}/)
  })
})

describe('RLSの明示化', () => {
  it('notifications・vacant_slot_applications・shift_modification_requests・shifts の4テーブルで、ENABLE ROW LEVEL SECURITYを明示している', () => {
    for (const t of ['public.notifications', 'public.vacant_slot_applications', 'public.shift_modification_requests', 'public.shifts']) {
      expect(sql).toContain(`alter table ${t} enable row level security;`)
    }
  })

  it('FORCE ROW LEVEL SECURITYは追加していない（service_role・管理処理への影響を未確認のため）', () => {
    expect(sql).not.toMatch(/force row level security/i)
  })
})

describe('新規CREATE POLICYの冪等性（drop policy if existsとの対）', () => {
  it('"vsa: admin が同店舗の申請を参照" は、直前にdrop policy if existsがある', () => {
    const idx = sql.indexOf('create policy "vsa: admin が同店舗の申請を参照"')
    expect(idx).toBeGreaterThan(-1)
    const before = sql.slice(Math.max(0, idx - 300), idx)
    expect(before).toContain('drop policy if exists "vsa: admin が同店舗の申請を参照"')
  })

  it('"smr: admin が同店舗の申請を参照" は、直前にdrop policy if existsがある', () => {
    const idx = sql.indexOf('create policy "smr: admin が同店舗の申請を参照"')
    expect(idx).toBeGreaterThan(-1)
    const before = sql.slice(Math.max(0, idx - 300), idx)
    expect(before).toContain('drop policy if exists "smr: admin が同店舗の申請を参照"')
  })

  it('この2つの新規ポリシー名は、対象migration自身を除く既存migration履歴のどこにも定義されていない（衝突による誤置換のリスクがない）', () => {
    // supabase/migrations配下の全ファイルを対象に、対象migration自身を除いて検索する
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const { join, dirname } = require('node:path') as typeof import('node:path')
    const migrationsDir = join(dirname(MIGRATION_PATH))
    const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && f !== '20260919000000_add_vacant_slot_application_requested_time.sql')
    for (const f of files) {
      const text = readFileSync(join(migrationsDir, f), 'utf8')
      expect(text, f).not.toContain('vsa: admin が同店舗の申請を参照')
      expect(text, f).not.toContain('smr: admin が同店舗の申請を参照')
    }
  })
})

describe('notifications既存3ポリシーのUSING句を変更していないことの確認', () => {
  it('ALTER POLICYのみで、CREATE POLICYによる作り直しはしていない（USING句を書き換えるリスクがない）', () => {
    for (const policy of ['notif: 自分の通知を参照', 'notif: admin が同店舗ユーザー宛の通知を参照', 'notif: 自分の通知を更新（既読）']) {
      expect(sql).toContain(`alter policy "${policy}" on public.notifications`)
      expect(sql).not.toContain(`create policy "${policy}" on public.notifications`)
    }
  })

  it('元定義（migration履歴上のファイル名）をコメントで明記している', () => {
    expect(sql).toContain('20260526142207_initial_schema.sql')
    expect(sql).toContain('20260816070000_admin_read_store_notifications.sql')
  })
})

describe('5つの内部専用関数（非SECURITY DEFINER）のEXECUTE権限', () => {
  const internalOnly = [
    { name: 'vacant_slot_ends_at', sig: 'public.vacant_slot_ends_at(date, time, time)' },
    { name: 'vacant_slot_effective_date', sig: 'public.vacant_slot_effective_date(date, time, time)' },
    { name: 'vacant_slot_format_date', sig: 'public.vacant_slot_format_date(date)' },
    { name: 'vacant_slot_format_range', sig: 'public.vacant_slot_format_range(time, time, time)' },
    { name: 'check_vacant_slot_application_requested_time', sig: 'public.check_vacant_slot_application_requested_time()' },
  ]

  it.each(internalOnly)('$name はPUBLIC・anon・authenticatedすべてからEXECUTEをrevokeされ、authenticatedへのgrantが無い', ({ sig }) => {
    expect(sql).toContain(`revoke execute on function ${sig} from public, anon, authenticated;`)
    expect(sql).not.toContain(`grant execute on function ${sig} to authenticated;`)
  })

  it('create_notification_internal（同じく非SECURITY DEFINERの内部専用関数）も同様にrevokeされている', () => {
    expect(sql).toContain(
      'revoke execute on function public.create_notification_internal(uuid, text, text, text) from public, anon, authenticated;'
    )
  })
})

describe('SECURITY DEFINER関数18本の機械的監査', () => {
  // kind: 'authenticated-rpc' = authenticatedへ限定grantされるRPC（呼び出し元コードから直接rpc()で呼ばれる）
  //       'trigger-internal'  = トリガー専用・PUBLIC/anon/authenticatedいずれにもgrantしない
  //       'service-role-only' = service_role専用（authenticatedにもgrantしない）
  const definerFunctions: { name: string; kind: 'authenticated-rpc' | 'trigger-internal' | 'service-role-only' }[] = [
    { name: 'apply_vacant_slot', kind: 'authenticated-rpc' },
    { name: 'cancel_vacant_slot_application', kind: 'authenticated-rpc' },
    { name: 'review_vacant_slot_application', kind: 'authenticated-rpc' },
    { name: 'set_vacant_slot_published', kind: 'authenticated-rpc' },
    { name: 'delete_vacant_slot', kind: 'authenticated-rpc' },
    { name: 'create_vacant_slot', kind: 'authenticated-rpc' },
    { name: 'create_shift_modification_request', kind: 'authenticated-rpc' },
    { name: 'review_shift_modification_request', kind: 'authenticated-rpc' },
    { name: 'send_shift_reminder', kind: 'authenticated-rpc' },
    { name: 'send_test_notification', kind: 'authenticated-rpc' },
    { name: 'guard_linked_shift_status', kind: 'trigger-internal' },
    { name: 'guard_linked_shift_delete', kind: 'trigger-internal' },
    { name: 'guard_linked_modification_request_status', kind: 'trigger-internal' },
    { name: 'guard_linked_modification_request_delete', kind: 'trigger-internal' },
    { name: 'notify_shift_update', kind: 'trigger-internal' },
    { name: 'notify_shift_delete', kind: 'trigger-internal' },
    { name: 'notify_modification_request_created', kind: 'trigger-internal' },
    { name: 'claim_pending_push_notifications', kind: 'service-role-only' },
  ]

  it('本テストが網羅している関数名の数が18本であること（監査対象の取りこぼしが無いことの確認）', () => {
    expect(definerFunctions).toHaveLength(18)
  })

  it.each(definerFunctions)('$name: security definer が付与されている', ({ name }) => {
    const body = extractFunctionBody(name)
    expect(body).toMatch(/\nsecurity definer\n/)
  })

  it.each(definerFunctions)('$name: search_path が \'\'（空）に固定されている', ({ name }) => {
    const body = extractFunctionBody(name)
    expect(body).toMatch(/\nset search_path = ''\n/)
  })

  // claim_pending_push_notifications: service_role専用で呼び出し元セッションを持たないため、
  // auth.uid()ではなくp_user_id引数で呼び出し元を明示的に受け取る設計（コメントで意図が明記されている）。
  // guard_linked_shift_delete: 認可ゲートではなく、shiftsの削除に追随してvacant_slot_applicationsの
  // 整合性を保つだけの後始末トリガー（app.vsa_managed以外は呼び出し元を問わず一律に動く設計）。
  const AUTH_UID_EXEMPT = new Set(['claim_pending_push_notifications', 'guard_linked_shift_delete'])
  it.each(definerFunctions.filter(f => !AUTH_UID_EXEMPT.has(f.name)))(
    '$name: auth.uid() による認証確認がある',
    ({ name }) => {
      const body = extractFunctionBody(name)
      expect(body).toContain('auth.uid()')
    }
  )

  it('guard_linked_shift_delete: 後始末トリガーとしての性質上、認可判断(auth.uid())を持たず、app.vsa_managedフラグだけで管理された操作を判別する', () => {
    const body = extractFunctionBody('guard_linked_shift_delete')
    expect(body).not.toContain('auth.uid()')
    expect(body).toContain("current_setting('app.vsa_managed', true)")
  })

  it('claim_pending_push_notifications: auth.uid()の代わりに、呼び出し元を明示引数p_user_idで受け取る設計になっている（service_role専用のため）', () => {
    const body = extractFunctionBody('claim_pending_push_notifications')
    expect(body).not.toContain('auth.uid()')
    expect(body).toContain('p_user_id uuid,')
    expect(body).toContain("if p_user_id is null then")
  })

  it.each(definerFunctions.filter(f => f.kind === 'authenticated-rpc'))(
    '$name: 店舗・ロール確認（my_role()またはmy_store_id()）がある',
    ({ name }) => {
      const body = extractFunctionBody(name)
      expect(body).toMatch(/my_role\(\)|my_store_id\(\)/)
    }
  )

  it.each(definerFunctions)('$name: PUBLICへのEXECUTEが明示的にrevokeされている（直接またはfrom句にpublicを含む）', ({ name }) => {
    const pattern = new RegExp(`revoke (all|execute) on function public\\.${name}\\([^)]*\\)[\\s\\S]{0,20}from[^;]*\\bpublic\\b`)
    expect(sql).toMatch(pattern)
  })

  it.each(definerFunctions.filter(f => f.kind === 'authenticated-rpc'))(
    '$name: anonへのEXECUTEがrevokeされ、authenticatedへは限定grantされている',
    ({ name }) => {
      const revokePattern = new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`)
      const grantPattern = new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`)
      expect(sql).toMatch(revokePattern)
      expect(sql).toMatch(grantPattern)
    }
  )

  it.each(definerFunctions.filter(f => f.kind === 'trigger-internal'))(
    '$name: PUBLIC・anon・authenticatedすべてからrevokeされ、authenticatedへのgrantが無い（トリガー専用）',
    ({ name }) => {
      expect(sql).toContain(`revoke execute on function public.${name}() from public, anon, authenticated;`)
      expect(sql).not.toContain(`grant execute on function public.${name}() to authenticated;`)
    }
  )

  it('claim_pending_push_notifications: PUBLIC・anon・authenticatedからrevokeされ、service_roleにのみgrantされている', () => {
    expect(sql).toContain(
      'revoke all on function public.claim_pending_push_notifications(uuid, integer, integer, integer) from public, anon, authenticated;'
    )
    expect(sql).toContain(
      'grant execute on function public.claim_pending_push_notifications(uuid, integer, integer, integer) to service_role;'
    )
    expect(sql).not.toContain(
      'grant execute on function public.claim_pending_push_notifications(uuid, integer, integer, integer) to authenticated;'
    )
  })

  // cancel_vacant_slot_applicationのみ例外: 対象を「呼び出し元(auth.uid())が作成した自分の申請」に
  // cast_id = v_uid で直接絞り込んでおり、店舗スコープより厳格な本人スコープでBOLA/IDORを防いでいる
  // （自分の申請である時点で、自店舗の空き枠に対する申請であることは apply_vacant_slot 側で保証済み）
  it.each(definerFunctions.filter(f => f.kind === 'authenticated-rpc' && f.name !== 'cancel_vacant_slot_application'))(
    '$name: 他店舗のID指定を拒否する店舗スコープの条件がある（store_id/my_store_id()の参照）',
    ({ name }) => {
      const body = extractFunctionBody(name)
      expect(body).toMatch(/store_id|my_store_id\(\)/)
    }
  )

  it('cancel_vacant_slot_application: 店舗スコープより厳格な本人スコープ（cast_id = 呼び出し元のauth.uid()）でBOLA/IDORを防いでいる', () => {
    const body = extractFunctionBody('cancel_vacant_slot_application')
    expect(body).toContain('cast_id = v_uid')
  })
})

describe('ロールバックコメントのデータ損失警告', () => {
  it('notifications列(created_by/push_sent_at)のDROPに、データ損失警告とバックアップの必要性が明記されている', () => {
    const idx = sql.indexOf(
      '-- alter table public.notifications drop constraint notifications_link_allowed, drop column created_by, drop column push_sent_at;'
    )
    expect(idx).toBeGreaterThan(-1)
    const before = sql.slice(Math.max(0, idx - 600), idx)
    expect(before).toMatch(/データ損失|失われる/)
    expect(before).toMatch(/バックアップ/)
  })

  it('vacant_slot_applications列のDROPの警告と同程度の明確さで書かれている（同じ表現パターンを使用）', () => {
    expect(sql).toContain('事前にバックアップすること')
    // vacant_slot_applications側の既存警告
    expect(sql).toContain('null/null以外の申請が存在する場合は事前にバックアップすること')
  })
})

describe('ヘッダーコメントの実態明記（ファイル名と内容の不一致の解消）', () => {
  it('空き枠機能以外に含む内容（通知権限強化・修正申請・シフトガード・テスト通知リマインド・Push配信claim）を明記している', () => {
    const header = sql.slice(0, sql.indexOf(PREFLIGHT_SECTION_MARKER))
    expect(header).toContain('notifications の直接書き込み権限の全面ロックダウン')
    expect(header).toContain('シフト修正申請')
    expect(header).toContain('ガードトリガー')
    expect(header).toContain('テスト通知・シフト提出リマインドRPC')
    expect(header).toContain('claim_pending_push_notifications')
  })

  it('空き枠だけを個別に無効化・ロールバックできないことを明記している', () => {
    const header = sql.slice(0, sql.indexOf(PREFLIGHT_SECTION_MARKER))
    expect(header).toMatch(/個別に有効化・無効化・ロールバックすることはできない/)
  })
})

describe('トランザクション前提についての注記', () => {
  it('SupabaseのExecBatchがファイル全体をBEGIN/COMMITで囲まないことをヘッダーに明記した上で、トランザクション非対応文が無いことを確認した根拠とともに明示的なBEGIN/COMMITを自前で追加している', () => {
    const header = sql.slice(0, sql.indexOf(PREFLIGHT_SECTION_MARKER))
    expect(header).toMatch(/BEGIN\/COMMIT/i)
    expect(header).toMatch(/CONCURRENTLY/i)
    expect(sql).toMatch(/^begin;$/m)
    expect(sql).toMatch(/^commit;$/m)
  })
})

describe('トランザクション対応（BEGIN/COMMITで全体を1トランザクションに囲む）', () => {
  it('BEGIN;がちょうど1回、末尾のCOMMIT;もちょうど1回だけ存在する', () => {
    expect((sql.match(/^begin;$/gm) || []).length).toBe(1)
    expect((sql.match(/^commit;$/gm) || []).length).toBe(1)
  })

  it('BEGIN;はPREFLIGHTブロック（最初のDDL相当の検査）より前、COMMIT;は最後の実行文（realtime設定）より後にある', () => {
    const beginIdx = sql.indexOf('\nbegin;\n')
    const preflightIdx = sql.indexOf(PREFLIGHT_SECTION_MARKER)
    const replicaIdentityIdx = sql.indexOf('alter table public.vacant_slot_applications replica identity full;')
    const commitIdx = sql.indexOf('\ncommit;\n')
    expect(beginIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(-1)
    expect(beginIdx).toBeLessThan(preflightIdx)
    expect(replicaIdentityIdx).toBeLessThan(commitIdx)
  })

  it('トランザクションブロック内で実行できない文が含まれていない（CONCURRENTLY・VACUUM・ALTER SYSTEM・CREATE/DROP DATABASE・TABLESPACE・ALTER TYPE ADD VALUE等）', () => {
    // 説明コメント中でこれらの語を「言及」することは許容し、実際に実行される文（行頭が--でない行）にだけ
    // 現れていないことを確認する（コメント行を除去してから検査する）
    const codeOnly = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
    expect(codeOnly).not.toMatch(/create\s+(unique\s+)?index\s+concurrently/i)
    expect(codeOnly).not.toMatch(/drop\s+index\s+concurrently/i)
    expect(codeOnly).not.toMatch(/reindex\s+.*concurrently/i)
    expect(codeOnly).not.toMatch(/^vacuum\b/im)
    expect(codeOnly).not.toMatch(/alter\s+system/i)
    expect(codeOnly).not.toMatch(/create\s+database|drop\s+database/i)
    expect(codeOnly).not.toMatch(/create\s+tablespace/i)
    expect(codeOnly).not.toMatch(/alter\s+type\s+\S+\s+add\s+value/i)
  })

  it('CREATE UNIQUE INDEXは2箇所とも通常形式（CONCURRENTLY無し）で、トランザクションブロック内で実行可能', () => {
    const indexes = sql.match(/^create unique index.*$/gm) || []
    expect(indexes).toHaveLength(2)
    for (const line of indexes) expect(line.toLowerCase()).not.toContain('concurrently')
  })
})

describe('ファイル全体の構造整合性（簡易静的チェック。DB接続なし）', () => {
  it('do $$ ブロックの数と、CREATE FUNCTION本体を含めた$$;終端の数が一致する', () => {
    const doBlocks = (sql.match(/^do \$\$$/gm) || []).length
    const functionDefs = (sql.match(/^create or replace function public\./gm) || []).length
    const terminators = (sql.match(/^\$\$;$/gm) || []).length
    expect(terminators).toBe(doBlocks + functionDefs)
  })

  it('migrationファイルの行数が前回監査時(1841行)から増えている（preflight追加分）', () => {
    const lines = sql.split('\n').length
    expect(lines).toBeGreaterThan(1841)
  })
})
