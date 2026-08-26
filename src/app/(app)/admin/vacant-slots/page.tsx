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

  const [{ data: slots }, { data: rooms }, { data: areas }, { data: settings }] = await Promise.all([
    // 過去の履歴も一覧・確認できるよう、日付での絞り込みは行わない
    supabase.from('vacant_slots')
      .select('*, rooms(name), areas(name), vacant_slot_applications(id, status, cast_id, shift_id, cast:users!vacant_slot_applications_cast_id_fkey(display_name))')
      .eq('store_id', storeId)
      .order('date', { ascending: false }).limit(200),
    supabase.from('rooms').select('id, name, area_id, capacity').eq('store_id', storeId).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', storeId).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <VacantSlotManager
        slots={slots ?? []} rooms={rooms ?? []} areas={areas ?? []} storeId={storeId} userId={user.id}
        locationMode={settings?.location_mode ?? 'room'}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
      />
    </div>
  )
}
