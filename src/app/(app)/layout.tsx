import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppNav } from '@/components/layout/app-nav'
import { getAccentSkin } from '@/lib/accent-skins'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id, accent_skin')
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

  // キャスト個人の「着せ替え」: ブランドアクセント色を個人の選択で上書き（店舗テーマとは別軸）
  const castSkin = role === 'cast' ? getAccentSkin(profile?.accent_skin) : null
  const accentStyle: React.CSSProperties = castSkin
    ? {
        '--brand-accent': castSkin.accent,
        '--brand-accent-2': castSkin.accent2,
        '--brand-accent-dark': castSkin.dark,
        '--cast-mobile-bg': castSkin.bg,
      } as React.CSSProperties
    : {}

  return (
    <div
      className={`flex h-screen ${castSkin?.isDark ? 'dark' : ''}`}
      style={{ backgroundColor: 'var(--app-bg)', ...accentStyle }}
      data-theme={theme}
    >
      <AppNav role={role} userEmail={user.email ?? ''} theme={theme} />
      <main
        className={`flex-1 overflow-y-auto md:pt-0 ${role === 'cast' ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 bg-[var(--cast-mobile-bg)] md:bg-transparent' : 'pt-14'}`}
      >
        {children}
      </main>
    </div>
  )
}
