import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastList } from '@/components/casts/cast-list'

export default async function CastsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [{ data: casts }, { data: profileFields }] = await Promise.all([
    supabase.from('users')
      .select('id, display_name, real_name, phone, reward_rate, is_active, email, profile_answers, photo_url, login_id')
      .eq('store_id', profile.store_id!)
      .eq('role', 'cast')
      .order('display_name'),
    supabase.from('cast_profile_fields')
      .select('id, label')
      .eq('store_id', profile.store_id!)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  return (
    <div className="p-6">
      <CastList casts={casts ?? []} storeId={profile.store_id!} profileFields={profileFields ?? []} />
    </div>
  )
}
