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

  const [{ data: allCasts }, { data: sales }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate, is_active')
      .eq('store_id', storeId).eq('role', 'cast').order('display_name'),
    supabase.from('sales').select('cast_id, amount, is_daily_payment, reward_rate_override, bonus, deduction')
      .eq('store_id', storeId).gte('date', from).lte('date', to),
  ])

  // 在籍中のキャストに加え、退店済みでもこの期間に売上実績があるキャストは一覧に残す
  // （辞めたキャストの最終給与処理ができなくなるのを防ぐ）
  const salesCastIdSet = new Set((sales ?? []).map(s => s.cast_id))
  const casts = (allCasts ?? []).filter(c => c.is_active || salesCastIdSet.has(c.id))

  return (
    <div className="p-6">
      <RewardCalculator
        key={`${from}-${to}`}
        casts={casts}
        sales={sales ?? []}
        storeId={storeId}
        from={from}
        to={to}
      />
    </div>
  )
}
