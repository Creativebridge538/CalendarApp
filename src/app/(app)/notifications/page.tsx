import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NotificationList } from '@/components/notifications/notification-list'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="p-6">
      <NotificationList notifications={notifications ?? []} userId={user.id} />
    </div>
  )
}
