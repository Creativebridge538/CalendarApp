import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { AppNav } from '@/components/layout/app-nav'
import { getAccentSkin } from '@/lib/accent-skins'
import { getAccentFont } from '@/lib/accent-fonts'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()

  if (!user) redirect('/login')

  // owner(SaaS運営者)は店舗に属さないため、この一般ユーザー向けシェルは経由させず内部管理画面に流す
  if (profile?.role === 'owner') redirect('/internal/stores')

  const [{ data: settings }, { data: store }] = profile?.store_id
    ? await Promise.all([
        supabase.from('store_settings').select('theme').eq('store_id', profile.store_id).single(),
        supabase.from('stores').select('name, is_active').eq('id', profile.store_id).single(),
      ])
    : [{ data: null }, { data: null }]

  if (store && !store.is_active) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <div className="space-y-2 max-w-sm">
          <p className="text-lg font-bold">この店舗は現在ご利用いただけません</p>
          <p className="text-sm text-muted-foreground">
            「{store.name}」はサービス提供者により利用停止されています。心当たりがない場合は運営までお問い合わせください。
          </p>
        </div>
      </div>
    )
  }

  const role = profile?.role ?? 'cast'
  // 管理画面は店舗ごとのデザインテーマ選択に関わらず、常に同じ見た目（default）に固定する
  const theme = role === 'admin' ? 'default' : ((settings as { theme?: string } | null)?.theme ?? 'default')

  // キャスト個人の「着せ替え」: ブランドアクセント色とフォントは、それぞれ独立して個人が選択できる（店舗テーマとは別軸）
  const castSkin = role === 'cast' ? getAccentSkin(profile?.accent_skin) : null
  const castFont = role === 'cast' ? getAccentFont(profile?.accent_font) : null
  const accentStyle: React.CSSProperties = {
    ...(castSkin
      ? {
          '--brand-accent': castSkin.accent,
          '--brand-accent-2': castSkin.accent2,
          '--brand-accent-dark': castSkin.dark,
          '--cast-mobile-bg': castSkin.bg,
          ...(castSkin.status
            ? {
                '--status-draft': castSkin.status.draft,
                '--status-submitted': castSkin.status.submitted,
                '--status-confirmed': castSkin.status.confirmed,
                '--status-rejected': castSkin.status.rejected,
              }
            : {}),
        }
      : {}),
    ...(castFont?.font ? { '--font-sans': castFont.font } : {}),
  } as React.CSSProperties

  return (
    <div
      className={`flex h-screen font-sans ${castSkin?.isDark ? 'dark' : ''}`}
      style={{ backgroundColor: 'var(--app-bg)', ...accentStyle }}
      data-theme={theme}
    >
      <AppNav role={role} userEmail={user.email ?? ''} theme={theme} />
      <main
        className={`flex-1 overflow-y-auto md:pt-0 ${role === 'cast' ? 'pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom)+2rem)] md:pb-0 bg-[var(--cast-mobile-bg)] md:bg-transparent' : 'pt-14 pb-8 md:pb-0'}`}
      >
        {children}
      </main>
    </div>
  )
}
