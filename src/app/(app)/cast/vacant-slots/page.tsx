import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { CastVacantSlots } from '@/components/vacant-slots/cast-vacant-slots'
import { nowJST } from '@/lib/jst'
import { isVacantSlotEnded, vacantSlotQueryFromDate } from '@/lib/vacant-slot-window'

export default async function CastVacantSlotsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const now = nowJST()
  const [{ data: slots }, { data: myApplications }, { data: settings }] = await Promise.all([
    supabase.from('vacant_slots')
      .select('*, rooms(name), areas(name)')
      .eq('store_id', profile.store_id)
      .eq('is_published', true)
      // 日またぎ枠は前日の日付のまま進行中になり得るため、昨日以降を取得し、実際の終了日時で絞り込む
      .gte('date', vacantSlotQueryFromDate(now))
      .order('date'),
    supabase.from('vacant_slot_applications')
      .select('id, vacant_slot_id, status, shift_id')
      .eq('cast_id', user.id),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', profile.store_id).single(),
  ])

  return (
    <div className="px-0 py-4 md:p-6">
      <CastVacantSlots
        slots={(slots ?? []).filter(slot => !isVacantSlotEnded(slot, now))} myApplications={myApplications ?? []} castId={user.id} storeId={profile.store_id}
        locationMode={settings?.location_mode ?? 'room'}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
      />
    </div>
  )
}
