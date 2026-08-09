import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { eachDayOfInterval, format } from 'date-fns'
import { CastShiftView } from '@/components/shifts/cast-shift-view'
import { getMonthToDateSummary } from '@/lib/reward-summary'

export default async function CastShiftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id, display_name, period_start_date, period_end_date').eq('id', user.id).single()
  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const periodDates = new Set<string>()
  if (profile.period_start_date && profile.period_end_date) {
    const start = new Date(`${profile.period_start_date}T00:00:00`)
    const end = new Date(`${profile.period_end_date}T00:00:00`)
    if (end >= start) {
      eachDayOfInterval({ start, end }).forEach(d => periodDates.add(format(d, 'yyyy-MM-dd')))
    }
  }

  const [{ data: shifts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems }, { data: store }, rewardSummary] = await Promise.all([
    supabase.from('shifts').select('*, rooms(name), areas(name)').eq('cast_id', user.id).order('date', { ascending: false }),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', profile.store_id).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('*').eq('store_id', profile.store_id).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type, options').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('stores').select('name').eq('id', profile.store_id).single(),
    getMonthToDateSummary(supabase, user.id),
  ])

  return (
    <div className="px-0 pb-4 md:p-6">
      <CastShiftView
        shifts={(shifts ?? []).map(s => ({ ...s, checklist_answers: (s.checklist_answers ?? {}) as Record<string, boolean | string> }))}
        rooms={rooms ?? []}
        areas={areas ?? []}
        castId={user.id}
        storeId={profile.store_id}
        storeName={store?.name ?? null}
        settings={settings}
        userId={user.id}
        checklistItems={checklistItems ?? []}
        periodDates={periodDates}
        rewardSummary={rewardSummary}
      />
    </div>
  )
}
