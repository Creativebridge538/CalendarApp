import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { NotificationList } from '@/components/notifications/notification-list'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  const isAdmin = profile?.role === 'admin'

  const [{ data: notifications }, { data: castRows }] = await Promise.all([
    supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    isAdmin && profile?.store_id
      ? supabase.from('users').select('id, display_name').eq('store_id', profile.store_id).eq('role', 'cast').eq('is_active', true).order('display_name')
      : Promise.resolve({ data: null }),
  ])

  return (
    <div className="p-6">
      <NotificationList
        notifications={notifications ?? []}
        userId={user.id}
        casts={isAdmin ? (castRows ?? []).map(c => ({ id: c.id, display_name: c.display_name })) : undefined}
      />
    </div>
  )
}
