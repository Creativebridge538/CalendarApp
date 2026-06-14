import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastRewardView } from '@/components/rewards/cast-reward-view'

export default async function CastRewardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rewards } = await supabase
    .from('reward_calculations')
    .select('*')
    .eq('cast_id', user.id)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(24)

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold">報酬明細</h1>
      <CastRewardView rewards={rewards ?? []} />
    </div>
  )
}
