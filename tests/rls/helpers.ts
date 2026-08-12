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

export const TEST_PASSWORD = 'test-password-12345'

export function getServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
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
  opts: { email: string; role: 'admin' | 'cast'; storeId: string; displayName: string }
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
