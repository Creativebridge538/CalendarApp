import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { VacantSlotManager } from '@/components/vacant-slots/vacant-slot-manager'
import { nowJST } from '@/lib/jst'
import { isVacantSlotListedForAdmin, vacantSlotQueryFromDate } from '@/lib/vacant-slot-window'

export default async function VacantSlotsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = nowJST()

  const [{ data: slots }, { data: rooms }, { data: areas }, { data: settings }] = await Promise.all([
    // 日付が過ぎた空き枠は一覧から消す（管理画面を今後の分だけにするため）。
    // ただし日またぎ枠は前日の日付のまま進行中になり得るため、昨日以降を取得して下で実際の終了日時を確認する
    supabase.from('vacant_slots')
      .select('*, rooms(name), areas(name), vacant_slot_applications(id, status, cast_id, shift_id, requested_start_time, requested_end_time, cast:users!vacant_slot_applications_cast_id_fkey(display_name))')
      .eq('store_id', storeId)
      .gte('date', vacantSlotQueryFromDate(now))
      .order('date', { ascending: true }).limit(200),
    supabase.from('rooms').select('id, name, area_id, capacity').eq('store_id', storeId).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', storeId).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <VacantSlotManager
        slots={(slots ?? []).filter(slot => isVacantSlotListedForAdmin(slot, now))} rooms={rooms ?? []} areas={areas ?? []} storeId={storeId}
        locationMode={settings?.location_mode ?? 'room'}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
      />
    </div>
  )
}
