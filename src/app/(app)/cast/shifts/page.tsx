import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { CastShiftView } from '@/components/shifts/cast-shift-view'
import { getMonthToDateSummary } from '@/lib/reward-summary'
import { effectiveRewardRate, parsePlatformRewardRates, includedInSalesTotal, customItemsTotal } from '@/lib/reward-rate'

export default async function CastShiftsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const [
    { data: shifts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems },
    { data: store }, rewardSummary, { data: sales }, { data: includedInSalesTemplates },
  ] = await Promise.all([
    supabase.from('shifts').select('*, rooms(name), areas(name)').eq('cast_id', user.id).order('date', { ascending: false }),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', profile.store_id).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('*').eq('store_id', profile.store_id).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type, options').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('stores').select('name').eq('id', profile.store_id).single(),
    getMonthToDateSummary(supabase, user.id, {
      reward_rate: profile.reward_rate, platform_reward_rates: profile.platform_reward_rates,
      daily_payment_reward_rate: profile.daily_payment_reward_rate, platform_daily_payment_reward_rates: profile.platform_daily_payment_reward_rates,
    }),
    supabase.from('sales').select('date, amount, platform, shift_id, is_daily_payment, reward_rate_override, bonus, deduction, custom_items').eq('cast_id', user.id),
    supabase.from('notice_item_templates').select('label').eq('store_id', profile.store_id).eq('include_in_sales', true),
  ])
  const includedInSalesLabels = new Set((includedInSalesTemplates ?? []).map(t => t.label))

  // シフトごとに最新の修正申請だけを見る。それが却下済みなら理由をシフト詳細に表示する
  // （新しい申請を出し直した場合は、そちらが最新になるので古い却下理由は自然に消える）
  const { data: modRequests } = await supabase.from('shift_modification_requests')
    .select('shift_id, status, reject_reason')
    .eq('requested_by', user.id)
    .order('created_at', { ascending: false })
  const rejectedModificationReasonByShiftId: Record<string, string> = {}
  const seenShiftIds = new Set<string>()
  for (const r of modRequests ?? []) {
    if (seenShiftIds.has(r.shift_id)) continue
    seenShiftIds.add(r.shift_id)
    if (r.status === 'rejected' && r.reject_reason) rejectedModificationReasonByShiftId[r.shift_id] = r.reject_reason
  }

  const { count: unreadNotificationCount } = await supabase.from('notifications')
    .select('*', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null)

  const amountByDate: Record<string, number> = {}
  const salesByShiftId: Record<string, { amount: number; reward: number }> = {}
  const rewardRate = Number(profile.reward_rate)
  const platformRates = parsePlatformRewardRates(profile.platform_reward_rates)
  const platformDailyRates = parsePlatformRewardRates(profile.platform_daily_payment_reward_rates)
  for (const s of sales ?? []) {
    // カレンダーの「金額表示」は、キャストが実際に受け取る女子給ベースの金額を表示する（売上ではない）
    const rate = effectiveRewardRate(s, rewardRate, platformRates, profile.daily_payment_reward_rate, platformDailyRates)
    const rewardAmount = Math.floor(Number(s.amount) * rate) + Number(s.bonus) - Number(s.deduction) + customItemsTotal(s.custom_items)
    amountByDate[s.date] = (amountByDate[s.date] ?? 0) + rewardAmount
    if (s.shift_id) {
      // 「売上に反映する」設定がオンのテンプレート項目は、管理画面の売上合計と同様にその分も加算する
      const salesAmount = Number(s.amount) + includedInSalesTotal(s.custom_items, includedInSalesLabels)
      const prev = salesByShiftId[s.shift_id] ?? { amount: 0, reward: 0 }
      salesByShiftId[s.shift_id] = {
        amount: prev.amount + salesAmount,
        reward: prev.reward + rewardAmount,
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
        rejectedModificationReasonByShiftId={rejectedModificationReasonByShiftId}
      />
    </div>
  )
}
