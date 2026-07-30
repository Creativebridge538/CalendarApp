import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/** 店舗に属さない role='owner' アカウントかどうかを判定する（SaaS運営者専用） */
export async function isPlatformOwner(
  supabase: SupabaseClient<Database>,
  userId: string | null | undefined
): Promise<boolean> {
  if (!userId) return false
  const { data } = await supabase.from('users').select('role').eq('id', userId).single()
  return data?.role === 'owner'
}
