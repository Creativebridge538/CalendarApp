import { execFileSync, spawn } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// ローカルsupabase(supabase start)の固定デモキー。全ローカル環境で共通の公開値であり秘密情報ではない。
// 本番相手には決して使えないURL/キーなので、このテストは常にローカルインスタンス限定で実行される。
const URL = process.env.TEST_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// テストはローカルsupabaseにしか接続してはいけない。環境変数(TEST_SUPABASE_URL)で外部のURLが
// 指定されていた場合（本番・別環境への誤接続）は、DBへ何も書き込む前にここで止める。
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const targetHost = (() => { try { return new globalThis.URL(URL).hostname } catch { return '' } })()
if (!LOCAL_HOSTS.has(targetHost)) {
  throw new Error('RLSテストはローカルのSupabase(127.0.0.1/localhost)にのみ接続できます。TEST_SUPABASE_URLがローカル以外を指しています。')
}

export const TEST_PASSWORD = 'test-password-12345'

export function getServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** サインインしていない（anon）クライアント */
export function getAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** 指定のemail/passwordでサインインした、RLSがそのまま効くanonキーのクライアントを返す */
export async function signInAs(email: string, password = TEST_PASSWORD): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInAs(${email}) failed: ${error.message}`)
  return client
}

export async function createTestUser(
  service: SupabaseClient<Database>,
  opts: { email: string; role: 'admin' | 'cast' | 'owner'; storeId: string; displayName: string }
): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: opts.email,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createTestUser(${opts.email}) failed: ${error?.message}`)
  const { error: updateError } = await service
    .from('users')
    .update({ role: opts.role, store_id: opts.storeId, display_name: opts.displayName, is_active: true })
    .eq('id', data.user.id)
  if (updateError) throw new Error(`profile setup for ${opts.email} failed: ${updateError.message}`)
  return data.user.id
}

// ---------------------------------------------------------------------------
// ローカルDB（supabase startのPostgresコンテナ）へ、docker経由でSQLを直接実行するヘルパー。
// PostgREST経由では作れない状況（通知INSERTの故障注入・アドバイザリロックの保持・ロック待ちの観測）を検証するために使う。
// 対象は project_id=CalendarApp のローカルコンテナ(supabase_db_CalendarApp)のみ。コンテナが無い環境では
// localDbAvailable() が false になり、該当テストはスキップされる（成功扱いにはならない）。
// ---------------------------------------------------------------------------
export const LOCAL_DB_CONTAINER = 'supabase_db_CalendarApp'

export function localDbAvailable(): boolean {
  try {
    return execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', LOCAL_DB_CONTAINER], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true'
  } catch {
    return false
  }
}

/** ローカルDBでSQLを実行して標準出力を返す（エラー時は例外） */
export function runLocalSql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8' })
}

/**
 * 別セッションで、空き枠単位のアドバイザリロックを ms ミリ秒だけ保持する（トランザクション内）。
 * ロックが実際に取得されるまで待ってから返す。返り値の done は、保持が終わって（コミットして）セッションが閉じたときに解決する。
 */
export async function holdSlotAdvisoryLock(slotId: string, ms: number): Promise<{ done: Promise<void> }> {
  const key = `vacant_slot:${slotId}`
  const child = spawn('docker', ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { stdio: ['pipe', 'ignore', 'ignore'] })
  const done = new Promise<void>(resolve => child.on('close', () => resolve()))
  child.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0)); select pg_sleep(${ms / 1000}); commit;\n`)
  child.stdin.end()
  const t0 = Date.now()
  for (;;) {
    const held = runLocalSql(`select count(*) from pg_locks where locktype = 'advisory' and granted and ((classid::bigint << 32) | objid::bigint) = hashtextextended('${key}', 0);`).trim()
    if (held !== '0') break
    if (Date.now() - t0 > 10000) { child.kill(); throw new Error('アドバイザリロックを取得できませんでした') }
    await new Promise(r => setTimeout(r, 50))
  }
  return { done }
}
