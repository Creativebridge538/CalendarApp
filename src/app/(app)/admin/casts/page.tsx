import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { CastList } from '@/components/casts/cast-list'

export default async function CastsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [{ data: casts }, { data: profileFields }, { data: stageNameRows }, { data: storeSettings }] = await Promise.all([
    supabase.from('users')
      .select('id, display_name, real_name, phone, reward_rate, platform_reward_rates, daily_payment_reward_rate, platform_daily_payment_reward_rates, is_active, email, profile_answers, photo_url, login_id, bank_name, bank_branch, bank_account_number, bank_account_holder')
      .eq('store_id', profile.store_id!)
      .eq('role', 'cast')
      .order('display_name'),
    supabase.from('cast_profile_fields')
      .select('id, label')
      .eq('store_id', profile.store_id!)
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('cast_stage_names')
      .select('cast_id, name')
      .eq('store_id', profile.store_id!),
    supabase.from('store_settings').select('enabled_platforms').eq('store_id', profile.store_id!).single(),
  ])

  const enabledPlatforms = storeSettings?.enabled_platforms ?? ['stripchat', 'fc2', 'dxlive']

  const stageNamesByCastId: Record<string, string[]> = {}
  for (const row of stageNameRows ?? []) {
    stageNamesByCastId[row.cast_id] ??= []
    stageNamesByCastId[row.cast_id].push(row.name)
  }

  return (
    <div className="p-6">
      <CastList
        casts={casts ?? []} storeId={profile.store_id!} profileFields={profileFields ?? []}
        stageNamesByCastId={stageNamesByCastId}
        enabledPlatforms={enabledPlatforms}
      />
    </div>
  )
}
