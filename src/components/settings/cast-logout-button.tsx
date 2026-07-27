'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function CastLogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Card elevated>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-4 py-3.5 text-red-600 hover:bg-red-50 transition-colors rounded-xl"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">ログアウト</span>
        </button>
      </CardContent>
    </Card>
  )
}
