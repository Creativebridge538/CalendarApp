'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Users, DoorOpen, Calendar, FileEdit,
  Briefcase, BarChart2, Award, Settings, Bell, LogOut,
  ChevronDown, Menu, X, MapPin, Palette, Plus, FileText, LayoutTemplate,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Logo } from '@/components/logo'
import { APP_NAME } from '@/lib/app-config'

// エリア・ルームの呼び名は店舗設定でカスタマイズできるため、サイドバーの項目名にもそれを反映する
function getAdminNav(areaLabel: string, roomLabel: string) {
  return [
    { href: '/dashboard',                   label: 'ダッシュボード',  icon: LayoutDashboard },
    { href: '/admin/shifts',                label: 'シフト管理',      icon: Calendar },
    { href: '/admin/casts',                 label: 'キャスト管理',    icon: Users },
    { href: '/admin/areas',                 label: `${areaLabel}管理`, icon: MapPin },
    { href: '/admin/rooms',                 label: `${roomLabel}管理`, icon: DoorOpen },
    { href: '/admin/modification-requests', label: '修正申請',        icon: FileEdit },
    { href: '/admin/vacant-slots',          label: '空き枠管理',      icon: Briefcase },
    { href: '/admin/sales',                 label: '売上一覧',        icon: BarChart2 },
    { href: '/admin/rewards',               label: '支払通知書作成',  icon: Award },
    { href: '/admin/issued-notices',        label: '発行済み支払通知書', icon: FileText },
    { href: '/admin/notice-template',       label: '通知書テンプレート設定', icon: LayoutTemplate },
    { href: '/notifications',               label: '通知',            icon: Bell },
    { href: '/admin/settings',              label: '店舗設定',        icon: Settings },
  ]
}

const castNav = [
  { href: '/cast/shifts',       label: 'シフト',         icon: Calendar },
  { href: '/cast/vacant-slots', label: '空き枠',         icon: Briefcase },
  { href: '/cast/rewards',      label: '収益',           icon: Award },
  { href: '/cast/settings',     label: '設定',           icon: Settings },
]

type ThemeStyles = {
  sidebar: React.CSSProperties
  border: string
  logo: React.CSSProperties
  subtext: React.CSSProperties
  link: React.CSSProperties
  linkHover: string
  linkActive: React.CSSProperties
  linkActiveHover: string
  userTrigger: React.CSSProperties
  mobileBar: React.CSSProperties
  mobileButton: React.CSSProperties
}

const THEME_STYLES: Record<string, ThemeStyles> = {
  default: {
    sidebar:        { backgroundColor: '#ffffff' },
    border:         'border-gray-200',
    logo:           { color: '#111827' },
    subtext:        { color: '#6b7280' },
    link:           { color: '#4b5563' },
    linkHover:      'hover:bg-[color-mix(in_srgb,var(--brand-accent)_8%,white)] hover:text-[var(--brand-accent-dark)]',
    linkActive:     { backgroundColor: 'color-mix(in srgb, var(--brand-accent) 14%, white)', color: 'var(--brand-accent-dark)', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#4b5563' },
    mobileBar:      { backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#111827' },
    mobileButton:   { color: '#4b5563' },
  },
  rose: {
    sidebar:        { backgroundColor: '#ffffff' },
    border:         'border-rose-100',
    logo:           { color: '#111827' },
    subtext:        { color: '#6b7280' },
    link:           { color: '#4b5563' },
    linkHover:      'hover:bg-rose-50 hover:text-rose-700',
    linkActive:     { backgroundColor: '#fff1f2', color: '#e11d48', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#4b5563' },
    mobileBar:      { backgroundColor: '#ffffff', borderColor: '#ffe4e6', color: '#111827' },
    mobileButton:   { color: '#4b5563' },
  },
  midnight: {
    sidebar:        { backgroundColor: '#1a2744' },
    border:         'border-white/10',
    logo:           { color: '#f9fafb' },
    subtext:        { color: '#94a3b8' },
    link:           { color: '#94a3b8' },
    linkHover:      'hover:bg-white/8 hover:text-white',
    linkActive:     { backgroundColor: 'rgba(99,102,241,0.25)', color: '#ffffff', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#94a3b8' },
    mobileBar:      { backgroundColor: '#1a2744', borderColor: 'rgba(255,255,255,0.1)', color: '#f9fafb' },
    mobileButton:   { color: '#94a3b8' },
  },
  emerald: {
    sidebar:        { backgroundColor: '#ffffff' },
    border:         'border-emerald-100',
    logo:           { color: '#111827' },
    subtext:        { color: '#6b7280' },
    link:           { color: '#4b5563' },
    linkHover:      'hover:bg-emerald-50 hover:text-emerald-700',
    linkActive:     { backgroundColor: '#d1fae5', color: '#065f46', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#4b5563' },
    mobileBar:      { backgroundColor: '#ffffff', borderColor: '#a7f3d0', color: '#111827' },
    mobileButton:   { color: '#4b5563' },
  },
  gold: {
    sidebar:        { backgroundColor: '#1c1610' },
    border:         'border-yellow-900/40',
    logo:           { color: '#fbbf24' },
    subtext:        { color: '#a16207' },
    link:           { color: '#d6b87a' },
    linkHover:      'hover:bg-yellow-900/30 hover:text-yellow-300',
    linkActive:     { backgroundColor: 'rgba(217,119,6,0.25)', color: '#fbbf24', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#d6b87a' },
    mobileBar:      { backgroundColor: '#1c1610', borderColor: 'rgba(217,119,6,0.3)', color: '#fbbf24' },
    mobileButton:   { color: '#d6b87a' },
  },
  violet: {
    sidebar:        { backgroundColor: '#1e1235' },
    border:         'border-white/10',
    logo:           { color: '#f5f3ff' },
    subtext:        { color: '#a78bfa' },
    link:           { color: '#c4b5fd' },
    linkHover:      'hover:bg-white/8 hover:text-white',
    linkActive:     { backgroundColor: 'rgba(124,58,237,0.30)', color: '#ffffff', fontWeight: '500' },
    linkActiveHover:'',
    userTrigger:    { color: '#c4b5fd' },
    mobileBar:      { backgroundColor: '#1e1235', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f3ff' },
    mobileButton:   { color: '#c4b5fd' },
  },
}

interface AppNavProps {
  role: string
  userEmail: string
  theme?: string
  areaLabel?: string
  roomLabel?: string
}

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard }

function NavContent({
  nav, pathname, s, userEmail, role, onLogout, onLinkClick,
}: {
  nav: NavItem[]
  pathname: string
  s: ThemeStyles
  userEmail: string
  role: string
  onLogout: () => void
  onLinkClick?: () => void
}) {
  const router = useRouter()
  return (
    <>
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                !isActive && s.linkHover
              )}
              style={isActive ? s.linkActive : s.link}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className={cn('px-2 py-2 border-t', s.border)}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn('flex w-full items-center justify-between px-3 py-2 rounded-md text-sm transition-colors', s.linkHover)}
            style={s.userTrigger}
          >
            <span className="truncate text-left">{userEmail}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-1" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {role === 'cast' && (
              <DropdownMenuItem onClick={() => { onLinkClick?.(); router.push('/cast/settings') }}>
                <Palette className="h-4 w-4 mr-2" />
                設定・着せ替え
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onLogout} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

export function AppNav({ role, userEmail, theme = 'default', areaLabel = 'エリア', roomLabel = 'ルーム' }: AppNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const nav = role === 'admin' ? getAdminNav(areaLabel, roomLabel) : castNav
  const [mobileOpen, setMobileOpen] = useState(false)
  const s = THEME_STYLES[theme] ?? THEME_STYLES.default
  const bottomNavRef = useRef<HTMLElement>(null)

  // 下部タブバーの実際の高さは機種・OSのレンダリング差で微妙に変わるため、決め打ちの余白では
  // 端末によってコンテンツ最下部がタブバーに隠れたり、逆に余白が大きすぎたりする。
  // 実測してCSS変数に反映し、コンテンツ側のpadding-bottomはそれを参照する
  useEffect(() => {
    if (!bottomNavRef.current) return
    const el = bottomNavRef.current
    const update = () => {
      document.documentElement.style.setProperty('--cast-tabbar-h', `${el.getBoundingClientRect().height}px`)
    }
    update()
    // フォント読み込み等で初回計測直後にラベルの高さがわずかに変わることがあるため、少し遅らせて再計測する
    const timers = [100, 500].map(delay => window.setTimeout(update, delay))
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('orientationchange', update)
    return () => {
      timers.forEach(t => window.clearTimeout(t))
      observer.disconnect()
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  // キャストの下部タブバーは店舗テーマに関わらず常に白基調（iOSネイティブ系の見た目）
  const castBottomBar: React.CSSProperties = {
    backgroundColor: '#ffffff',
    color: '#8e8e93',
  }

  // iOS PWA: パスワード欄のあるログイン画面からの遷移直後、WebKitがセーフエリア
  // （ステータスバー分の余白）の再計算をすぐ行わず、コンテンツが一時的にステータスバーの
  // 裏に潜り込むことがある（時間が経つ・操作すると自然に直る）。viewportのmetaタグの
  // 値を触ってあげることで、iOS側にセーフエリアの再計算を強制的に促す
  useEffect(() => {
    function touchViewportMeta() {
      const meta = document.querySelector('meta[name="viewport"]')
      if (!meta) return
      const content = meta.getAttribute('content') ?? ''
      meta.setAttribute('content', `${content}, viewport-fit=cover`)
      requestAnimationFrame(() => meta.setAttribute('content', content))
    }
    const timers = [0, 150, 350, 600, 1000].map(delay => window.setTimeout(touchViewportMeta, delay))
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* デスクトップ サイドバー */}
      <aside
        className={cn('hidden md:flex w-56 shrink-0 border-r flex-col h-screen sticky top-0', s.border)}
        style={s.sidebar}
      >
        <div className={cn('px-4 py-4 border-b', s.border)}>
          <div className="flex items-center gap-2.5" style={s.logo}>
            <Logo className="h-7 w-7 shrink-0" />
            <p className="font-bold text-lg tracking-tight">{APP_NAME}</p>
          </div>
          <p className="text-xs mt-0.5" style={s.subtext}>
            {role === 'admin' ? '管理者' : 'キャスト'}
          </p>
        </div>
        <NavContent nav={nav} pathname={pathname} s={s} userEmail={userEmail} role={role} onLogout={handleLogout} />
      </aside>

      {role === 'cast' ? (
        <>
          {/* キャスト: 固定の上部バーは廃止（ハンバーガーはシフト画面自身に持たせる）*/}

          {/* キャスト: 下部タブバー（フラット・全幅。アクティブはアイコン+ラベルの色が変わるだけ）。
              中央はシフト作成の浮き出しボタン（iOSネイティブ系タブバーの「作成」ボタンと同じ配置） */}
          <nav
            ref={bottomNavRef}
            className="md:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t"
            style={{
              ...castBottomBar,
              borderColor: '#ededed',
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 6px)',
            }}
          >
            {nav.slice(0, 2).map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
                  style={{ color: isActive ? 'var(--brand-accent)' : castBottomBar.color }}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[10px] font-medium">{label}</span>
                </Link>
              )
            })}

            <div className="relative flex flex-col items-center justify-start pt-0">
              <Link
                href="/cast/shifts?new=1"
                aria-label="シフトを作成"
                className="-mt-[22px] flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-[0_6px_16px_-4px_color-mix(in_srgb,var(--brand-accent)_60%,transparent)] ring-4 transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--brand-accent)', ['--tw-ring-color' as string]: castBottomBar.backgroundColor as string }}
              >
                <Plus className="h-6 w-6 text-white" strokeWidth={2.5} />
              </Link>
              <span className="mt-1.5 text-[10px] font-medium" style={{ color: castBottomBar.color }}>作成</span>
            </div>

            {nav.slice(2, 4).map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
                  style={{ color: isActive ? 'var(--brand-accent)' : castBottomBar.color }}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[10px] font-medium">{label}</span>
                </Link>
              )
            })}
          </nav>
        </>
      ) : (
        <>
          {/* 管理者: モバイル トップバー */}
          <div
            className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 border-b flex items-center px-4 gap-3"
            style={s.mobileBar}
          >
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1 rounded-md hover:bg-white/10"
              style={s.mobileButton}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Logo className="h-5 w-5 shrink-0" />
            <span className="font-bold tracking-tight">{APP_NAME}</span>
          </div>

          {/* 管理者: モバイル ドロワー */}
          {mobileOpen && (
            <div className="md:hidden fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
              <aside
                className={cn('relative w-64 flex flex-col h-full shadow-xl border-r', s.border)}
                style={s.sidebar}
              >
                <div className={cn('px-4 py-4 border-b flex items-center justify-between', s.border)}>
                  <div>
                    <div className="flex items-center gap-2.5" style={s.logo}>
                      <Logo className="h-6 w-6 shrink-0" />
                      <p className="font-bold text-lg tracking-tight">{APP_NAME}</p>
                    </div>
                    <p className="text-xs mt-0.5" style={s.subtext}>管理者</p>
                  </div>
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="p-1 rounded-md hover:bg-white/10"
                    style={s.mobileButton}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <NavContent
                  nav={nav} pathname={pathname} s={s} userEmail={userEmail} role={role}
                  onLogout={handleLogout} onLinkClick={() => setMobileOpen(false)}
                />
              </aside>
            </div>
          )}
        </>
      )}
    </>
  )
}
