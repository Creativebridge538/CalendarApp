import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { VacantSlotManager } from '@/components/vacant-slots/vacant-slot-manager'

export default async function VacantSlotsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: slots }, { data: rooms }] = await Promise.all([
    supabase.from('vacant_slots')
      .select('*, rooms(name), vacant_slot_applications(id, status, cast_id, cast:users!vacant_slot_applications_cast_id_fkey(display_name))')
      .eq('store_id', storeId).order('date', { ascending: false }).limit(50),
    supabase.from('rooms').select('id, name').eq('store_id', storeId).eq('is_active', true),
  ])

  return (
    <div className="p-6">
      <VacantSlotManager slots={slots ?? []} rooms={rooms ?? []} storeId={storeId} userId={user.id} />
    </div>
  )
}
