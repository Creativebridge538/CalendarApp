import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastShiftView } from '@/components/shifts/cast-shift-view'

export default async function CastShiftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (!profile?.store_id) redirect('/dashboard')

  const [{ data: shifts }, { data: rooms }, { data: areas }, { data: settings }] = await Promise.all([
    supabase.from('shifts').select('*, rooms(name), areas(name)').eq('cast_id', user.id).order('date', { ascending: false }).limit(60),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', profile.store_id).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('*').eq('store_id', profile.store_id).single(),
  ])

  return (
    <div className="px-0 py-4 md:p-6">
      <CastShiftView shifts={shifts ?? []} rooms={rooms ?? []} areas={areas ?? []} castId={user.id} storeId={profile.store_id} settings={settings} userId={user.id} />
    </div>
  )
}
