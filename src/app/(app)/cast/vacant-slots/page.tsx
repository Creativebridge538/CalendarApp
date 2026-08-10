import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastVacantSlots } from '@/components/vacant-slots/cast-vacant-slots'

export default async function CastVacantSlotsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('store_id').eq('id', user.id).single()
  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const [{ data: slots }, { data: myApplications }] = await Promise.all([
    supabase.from('vacant_slots')
      .select('*, rooms(name)')
      .eq('store_id', profile.store_id)
      .eq('is_published', true)
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date'),
    supabase.from('vacant_slot_applications')
      .select('vacant_slot_id, status')
      .eq('cast_id', user.id),
  ])

  return (
    <div className="px-0 py-4 md:p-6">
      <CastVacantSlots slots={slots ?? []} myApplications={myApplications ?? []} castId={user.id} storeId={profile.store_id} />
    </div>
  )
}
