import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StoreSettings } from '@/components/settings/store-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: store }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('store_settings').select('*').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <StoreSettings store={store} settings={settings} storeId={storeId} />
    </div>
  )
}
