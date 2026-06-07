import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ModificationRequestList } from '@/components/shifts/modification-request-list'

export default async function ModificationRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: requests } = await supabase
    .from('shift_modification_requests')
    .select('*, shifts(date, start_time, end_time, store_id, cast:users!shifts_cast_id_fkey(display_name))')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const storeRequests = (requests ?? []).filter(
    r => (r.shifts as { store_id: string } | null)?.store_id === profile.store_id
  )

  return (
    <div className="p-6">
      <ModificationRequestList requests={storeRequests} />
    </div>
  )
}
