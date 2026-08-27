import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { CastShiftView } from '@/components/shifts/cast-shift-view'
import { getMonthToDateSummary } from '@/lib/reward-summary'
import { effectiveRewardRate, parsePlatformRewardRates } from '@/lib/reward-rate'

export default async function CastShiftsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const [{ data: shifts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems }, { data: store }, rewardSummary, { data: sales }] = await Promise.all([
    supabase.from('shifts').select('*, rooms(name), areas(name)').eq('cast_id', user.id).order('date', { ascending: false }),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', profile.store_id).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('*').eq('store_id', profile.store_id).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type, options').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('stores').select('name').eq('id', profile.store_id).single(),
    getMonthToDateSummary(supabase, user.id),
    supabase.from('sales').select('date, amount, platform, shift_id, is_daily_payment, reward_rate_override').eq('cast_id', user.id),
  ])

  const { count: unreadNotificationCount } = await supabase.from('notifications')
    .select('*', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null)

  const amountByDate: Record<string, number> = {}
  const salesByShiftId: Record<string, { amount: number; reward: number }> = {}
  const rewardRate = Number(profile.reward_rate)
  const platformRates = parsePlatformRewardRates(profile.platform_reward_rates)
  for (const s of sales ?? []) {
    amountByDate[s.date] = (amountByDate[s.date] ?? 0) + Number(s.amount)
    if (s.shift_id) {
      const rate = effectiveRewardRate(s, rewardRate, platformRates, profile.daily_payment_reward_rate)
      const prev = salesByShiftId[s.shift_id] ?? { amount: 0, reward: 0 }
      salesByShiftId[s.shift_id] = {
        amount: prev.amount + Number(s.amount),
        reward: prev.reward + Math.floor(Number(s.amount) * rate),
      }
    }
  }

  return (
    <div className="px-0 pb-4 md:p-6">
      <CastShiftView
        shifts={(shifts ?? []).map(s => ({ ...s, checklist_answers: (s.checklist_answers ?? {}) as Record<string, boolean | string> }))}
        rooms={rooms ?? []}
        areas={areas ?? []}
        castId={user.id}
        castName={profile.display_name}
        storeId={profile.store_id}
        storeName={store?.name ?? null}
        settings={settings}
        userId={user.id}
        checklistItems={checklistItems ?? []}
        rewardSummary={rewardSummary}
        amountByDate={amountByDate}
        salesByShiftId={salesByShiftId}
        unreadNotificationCount={unreadNotificationCount ?? 0}
      />
    </div>
  )
}
