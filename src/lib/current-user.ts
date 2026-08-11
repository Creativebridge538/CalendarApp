import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type Profile = Database['public']['Tables']['users']['Row']

// layout.tsxと各page.tsxの両方から呼ばれるが、cache()により同一リクエスト内では
// セッション確認とusersテーブルへの問い合わせはそれぞれ1回だけしか実行されない
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) return { user: null, profile: null as Profile | null }

  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
  return { user, profile }
})
