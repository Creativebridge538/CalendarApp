import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { ModificationRequestList } from '@/components/shifts/modification-request-list'

export default async function ModificationRequestsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [{ data: requests }, { data: settings }] = await Promise.all([
    supabase
      .from('shift_modification_requests')
      .select('*, shifts(date, start_time, end_time, store_id, cast:users!shifts_cast_id_fkey(display_name))')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase.from('store_settings').select('room_label').eq('store_id', profile.store_id!).single(),
  ])

  const storeRequests = (requests ?? []).filter(
    r => (r.shifts as { store_id: string } | null)?.store_id === profile.store_id
  )

  return (
    <div className="p-6">
      <ModificationRequestList requests={storeRequests} roomLabel={settings?.room_label || 'ルーム'} />
    </div>
  )
}
