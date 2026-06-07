import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastList } from '@/components/casts/cast-list'

export default async function CastsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: casts } = await supabase
    .from('users')
    .select('id, display_name, real_name, phone, reward_rate, is_active, email')
    .eq('store_id', profile.store_id!)
    .eq('role', 'cast')
    .order('display_name')

  return (
    <div className="p-6">
      <CastList casts={casts ?? []} storeId={profile.store_id!} />
    </div>
  )
}
