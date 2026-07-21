import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppNav } from '@/components/layout/app-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  const { data: settings } = profile?.store_id
    ? await supabase
        .from('store_settings')
        .select('theme')
        .eq('store_id', profile.store_id)
        .single()
    : { data: null }

  const role = profile?.role ?? 'cast'
  // 管理者は店舗テーマ設定に関わらず、常に専用の固定ダークテーマ（analytics基調）を使う
  const theme = role === 'admin' ? 'admin-pro' : ((settings as { theme?: string } | null)?.theme ?? 'default')

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--app-bg)' }} data-theme={theme}>
      <AppNav role={role} userEmail={user.email ?? ''} theme={theme} />
      <main
        className={`flex-1 overflow-y-auto pt-14 md:pt-0 ${role === 'cast' ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}
      >
        {children}
      </main>
    </div>
  )
}
