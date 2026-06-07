import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RewardCalculator } from '@/components/rewards/reward-calculator'

export default async function RewardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = new Date()

  const [{ data: casts }, { data: rewards }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate')
      .eq('store_id', storeId).eq('role', 'cast').eq('is_active', true).order('display_name'),
    supabase.from('reward_calculations').select('*').eq('store_id', storeId)
      .eq('period_year', now.getFullYear()).eq('period_month', now.getMonth() + 1),
  ])

  return (
    <div className="p-6">
      <RewardCalculator
        casts={casts ?? []}
        rewards={rewards ?? []}
        storeId={storeId}
        userId={user.id}
        year={now.getFullYear()}
        month={now.getMonth() + 1}
      />
    </div>
  )
}
