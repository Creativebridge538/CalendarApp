import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, endOfMonth } from 'date-fns'
import { RewardCalculator } from '@/components/rewards/reward-calculator'

export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = new Date()
  const { year: yearParam, month: monthParam } = await searchParams
  const year = parseInt(yearParam ?? '') || now.getFullYear()
  const month = parseInt(monthParam ?? '') || now.getMonth() + 1

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = format(endOfMonth(new Date(`${monthStart}T00:00:00`)), 'yyyy-MM-dd')

  const [{ data: allCasts }, { data: rewards }, { data: salesCastIds }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate, is_active')
      .eq('store_id', storeId).eq('role', 'cast').order('display_name'),
    supabase.from('reward_calculations').select('*').eq('store_id', storeId)
      .eq('period_year', year).eq('period_month', month),
    supabase.from('sales').select('cast_id').eq('store_id', storeId)
      .gte('date', monthStart).lte('date', monthEnd),
  ])

  // 在籍中のキャストに加え、退店済みでもこの期間に売上・報酬実績があるキャストは一覧に残す
  // （月の途中で辞めたキャストの最終給与処理ができなくなるのを防ぐ）
  const rewardCastIds = new Set((rewards ?? []).map(r => r.cast_id))
  const salesCastIdSet = new Set((salesCastIds ?? []).map(s => s.cast_id))
  const casts = (allCasts ?? []).filter(c => c.is_active || rewardCastIds.has(c.id) || salesCastIdSet.has(c.id))

  return (
    <div className="p-6">
      <RewardCalculator
        key={`${year}-${month}`}
        casts={casts}
        rewards={rewards ?? []}
        storeId={storeId}
        userId={user.id}
        year={year}
        month={month}
      />
    </div>
  )
}
