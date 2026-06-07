'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Users, DoorOpen, Calendar, FileEdit,
  Briefcase, BarChart2, Award, Settings, Bell, LogOut,
  ChevronDown, Menu, X, MapPin,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const adminNav = [
  { href: '/dashboard',                   label: 'ダッシュボード',  icon: LayoutDashboard },
  { href: '/admin/shifts',                label: 'シフト管理',      icon: Calendar },
  { href: '/admin/casts',                 label: 'キャスト管理',    icon: Users },
  { href: '/admin/areas',                 label: 'エリア管理',      icon: MapPin },
  { href: '/admin/rooms',                 label: 'ルーム管理',      icon: DoorOpen },
  { href: '/admin/modification-requests', label: '修正申請',        icon: FileEdit },
  { href: '/admin/vacant-slots',          label: '空き枠管理',      icon: Briefcase },
  { href: '/admin/sales',                 label: '売上入力',        icon: BarChart2 },
  { href: '/admin/rewards',              label: '報酬計算',        icon: Award },
  { href: '/notifications',              label: '通知',            icon: Bell },
  { href: '/admin/settings',             label: '店舗設定',        icon: Settings },
]

const castNav = [
  { href: '/dashboard',         label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/cast/shifts',       label: 'シフト提出',     icon: Calendar },
  { href: '/cast/vacant-slots', label: '空き枠',         icon: Briefcase },
  { href: '/cast/rewards',      label: '報酬明細',       icon: Award },
  { href: '/notifications',     label: '通知',           icon: Bell },
]

interface AppNavProps {
  role: string
  userEmail: string
}

export function AppNav({ role, userEmail }: AppNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const nav = role === 'admin' ? adminNav : castNav
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const NavContent = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <>
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onLinkClick}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
              pathname === href || pathname.startsWith(href + '/')
                ? 'bg-gray-100 font-medium text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-2 py-2 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center justify-between px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900">
            <span className="truncate text-left">{userEmail}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-1" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )

  return (
    <>
      {/* デスクトップ サイドバー */}
      <aside className="hidden md:flex w-56 shrink-0 bg-white border-r flex-col h-screen sticky top-0">
        <div className="px-4 py-4 border-b">
          <p className="font-bold text-lg tracking-tight">CalendarApp</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {role === 'admin' ? '管理者' : 'キャスト'}
          </p>
        </div>
        <NavContent />
      </aside>

      {/* モバイル トップバー */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1 rounded-md text-gray-600 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-bold tracking-tight">CalendarApp</span>
      </div>

      {/* モバイル ドロワー */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          {/* ドロワー本体 */}
          <aside className="relative w-64 bg-white flex flex-col h-full shadow-xl">
            <div className="px-4 py-4 border-b flex items-center justify-between">
              <div>
                <p className="font-bold text-lg tracking-tight">CalendarApp</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {role === 'admin' ? '管理者' : 'キャスト'}
                </p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1 rounded-md text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavContent onLinkClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
