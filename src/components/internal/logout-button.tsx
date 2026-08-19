'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

// owner専用の内部画面((app)配下のシェルを経由しない)には通常のログアウトボタンが無いため専用に用意する
export function InternalLogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout}>
      <LogOut className="h-3.5 w-3.5 mr-1" />ログアウト
    </Button>
  )
}
