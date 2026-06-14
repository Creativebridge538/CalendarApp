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

  const theme = (settings as { theme?: string } | null)?.theme ?? 'default'

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--app-bg)' }} data-theme={theme}>
      <AppNav role={profile?.role ?? 'cast'} userEmail={user.email ?? ''} theme={theme} />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  )
}
