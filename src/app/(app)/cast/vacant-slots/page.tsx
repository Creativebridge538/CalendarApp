import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { CastVacantSlots } from '@/components/vacant-slots/cast-vacant-slots'

export default async function CastVacantSlotsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const [{ data: slots }, { data: myApplications }, { data: settings }] = await Promise.all([
    supabase.from('vacant_slots')
      .select('*, rooms(name), areas(name)')
      .eq('store_id', profile.store_id)
      .eq('is_published', true)
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date'),
    supabase.from('vacant_slot_applications')
      .select('vacant_slot_id, status, shift_id')
      .eq('cast_id', user.id),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', profile.store_id).single(),
  ])

  return (
    <div className="px-0 py-4 md:p-6">
      <CastVacantSlots
        slots={slots ?? []} myApplications={myApplications ?? []} castId={user.id} storeId={profile.store_id}
        locationMode={settings?.location_mode ?? 'room'}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
      />
    </div>
  )
}
