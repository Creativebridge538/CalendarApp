import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { VacantSlotManager } from '@/components/vacant-slots/vacant-slot-manager'

export default async function VacantSlotsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: slots }, { data: rooms }] = await Promise.all([
    supabase.from('vacant_slots')
      .select('*, rooms(name), vacant_slot_applications(id, status, cast_id, shift_id, cast:users!vacant_slot_applications_cast_id_fkey(display_name))')
      .eq('store_id', storeId)
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date', { ascending: false }).limit(50),
    supabase.from('rooms').select('id, name').eq('store_id', storeId).eq('is_active', true),
  ])

  return (
    <div className="p-6">
      <VacantSlotManager slots={slots ?? []} rooms={rooms ?? []} storeId={storeId} userId={user.id} />
    </div>
  )
}
