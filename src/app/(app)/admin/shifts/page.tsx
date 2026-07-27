import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { eachDayOfInterval, format } from 'date-fns'
import { AdminShiftView } from '@/components/shifts/admin-shift-view'

export default async function AdminShiftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: shifts }, { data: casts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems }] = await Promise.all([
    supabase.from('shifts')
      .select('*, cast:users!shifts_cast_id_fkey(display_name), rooms(name)')
      .eq('store_id', storeId)
      .order('date', { ascending: false })
      .order('start_time')
      .limit(200),
    supabase.from('users').select('id, display_name, period_start_date, period_end_date').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', storeId).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', storeId).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('location_mode, area_label, room_label').eq('store_id', storeId).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type').eq('store_id', storeId),
  ])

  const periodDates = new Set<string>()
  for (const cast of casts ?? []) {
    if (!cast.period_start_date || !cast.period_end_date) continue
    const start = new Date(`${cast.period_start_date}T00:00:00`)
    const end = new Date(`${cast.period_end_date}T00:00:00`)
    if (end < start) continue
    eachDayOfInterval({ start, end }).forEach(d => periodDates.add(format(d, 'yyyy-MM-dd')))
  }

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
        periodDates={periodDates}
      />
    </div>
  )
}
