import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'
import { StoreList } from '@/components/internal/store-list'
import { InternalLogoutButton } from '@/components/internal/logout-button'

export default async function InternalStoresPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!(await isPlatformOwner(supabase, user?.id))) redirect('/dashboard')

  const admin = createAdminClient()
  const [{ data: stores }, { data: users }] = await Promise.all([
    admin.from('stores').select('id, name, created_at, is_active').order('created_at', { ascending: false }),
    admin.from('users').select('store_id, role, email, display_name, is_active'),
  ])

  const rows = (stores ?? []).map(store => {
    const storeUsers = (users ?? []).filter(u => u.store_id === store.id)
    const admins = storeUsers.filter(u => u.role === 'admin')
    const castCount = storeUsers.filter(u => u.role === 'cast' && u.is_active).length
    return { ...store, admins, castCount }
  })

  return (
    <div className="min-h-screen bg-[var(--app-bg)] py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold">店舗一覧</h1>
            <p className="text-sm text-muted-foreground mt-0.5">登録済みの全店舗の閲覧・利用停止/再開ができます</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/internal/signups" className="text-sm text-primary underline underline-offset-2">
              新規店舗の申込レビューへ
            </Link>
            <InternalLogoutButton />
          </div>
        </div>
        <StoreList stores={rows} />
      </div>
    </div>
  )
}
