import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { AdminShiftView } from '@/components/shifts/admin-shift-view'

export default async function AdminShiftsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: shifts }, { data: casts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems }] = await Promise.all([
    supabase.from('shifts')
      .select('*, cast:users!shifts_cast_id_fkey(display_name), rooms(name), areas(name)')
      .eq('store_id', storeId)
      .order('date', { ascending: false })
      .order('start_time')
      .limit(200),
    supabase.from('users').select('id, display_name').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true),
    supabase.from('rooms').select('id, name, area_id, capacity').eq('store_id', storeId).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', storeId).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', storeId).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type').eq('store_id', storeId),
  ])

  return (
    <div className="px-0 py-4 md:p-6">
      <AdminShiftView
        shifts={(shifts ?? []).map(s => ({ ...s, checklist_answers: (s.checklist_answers ?? {}) as Record<string, boolean | string> }))}
        casts={casts ?? []}
        rooms={rooms ?? []}
        areas={areas ?? []}
        storeId={storeId}
        locationMode={settings?.location_mode ?? 'room'}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
        checklistItems={checklistItems ?? []}
      />
    </div>
  )
}
