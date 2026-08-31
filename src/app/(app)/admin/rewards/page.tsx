import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { RewardCalculator } from '@/components/rewards/reward-calculator'

export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = new Date()
  const { from: fromParam, to: toParam } = await searchParams
  const from = fromParam || format(startOfMonth(now), 'yyyy-MM-dd')
  const to = toParam || format(endOfMonth(now), 'yyyy-MM-dd')

  const [{ data: allCasts }, { data: sales }, { data: settings }, { data: includedInSalesTemplates }] = await Promise.all([
    supabase.from('users').select('id, display_name, real_name, reward_rate, platform_reward_rates, daily_payment_reward_rate, platform_daily_payment_reward_rates, is_active')
      .eq('store_id', storeId).eq('role', 'cast').order('display_name'),
    supabase.from('sales').select('cast_id, amount, platform, is_daily_payment, reward_rate_override, bonus, deduction, custom_items')
      .eq('store_id', storeId).gte('date', from).lte('date', to),
    supabase.from('store_settings').select('notice_item_config').eq('store_id', storeId).single(),
    supabase.from('notice_item_templates').select('label').eq('store_id', storeId).eq('include_in_sales', true),
  ])

  // 在籍中のキャストに加え、退店済みでもこの期間に売上実績があるキャストは一覧に残す
  // （辞めたキャストの最終給与処理ができなくなるのを防ぐ）
  const salesCastIdSet = new Set((sales ?? []).map(s => s.cast_id))
  const casts = (allCasts ?? []).filter(c => c.is_active || salesCastIdSet.has(c.id))

  // この期間ですでに発行済みのキャストを把握する（通知のlinkに含まれるfrom/toで判定）
  const castIds = casts.map(c => c.id)
  const { data: noticeRows } = castIds.length > 0
    ? await supabase.from('notifications')
        .select('user_id, link, created_at')
        .in('user_id', castIds)
        .eq('title', '支払通知書が届きました')
        .order('created_at', { ascending: false })
    : { data: [] }

  const issuedAt: Record<string, string> = {}
  for (const n of noticeRows ?? []) {
    if (issuedAt[n.user_id]) continue // 最新（先頭）だけ拾う
    try {
      const url = new URL(n.link ?? '', 'http://placeholder')
      if (url.searchParams.get('from') === from && url.searchParams.get('to') === to) {
        issuedAt[n.user_id] = n.created_at
      }
    } catch {
      // noop
    }
  }

  return (
    <div className="p-6">
      <RewardCalculator
        key={`${from}-${to}`}
        casts={casts}
        sales={sales ?? []}
        storeId={storeId}
        from={from}
        to={to}
        issuedAt={issuedAt}
        noticeItemConfig={settings?.notice_item_config}
        includedInSalesLabels={(includedInSalesTemplates ?? []).map(t => t.label)}
      />
    </div>
  )
}
