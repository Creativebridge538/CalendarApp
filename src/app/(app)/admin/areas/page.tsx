import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AreaList } from '@/components/areas/area-list'

export default async function AreasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: areas }, { data: settings }] = await Promise.all([
    supabase.from('areas').select('*').eq('store_id', storeId).order('sort_order'),
    supabase.from('store_settings').select('area_label').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <AreaList
        areas={areas ?? []}
        storeId={storeId}
        areaLabel={settings?.area_label ?? 'エリア'}
      />
    </div>
  )
}
