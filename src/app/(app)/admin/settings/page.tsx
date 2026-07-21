import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StoreSettings } from '@/components/settings/store-settings'
import { ShiftChecklistSettings } from '@/components/settings/shift-checklist-settings'
import { CastProfileFieldsSettings } from '@/components/settings/cast-profile-fields-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: store }, { data: settings }, { data: checklistItems }, { data: profileFields }] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('store_settings').select('*').eq('store_id', storeId).single(),
    supabase.from('shift_checklist_items').select('*').eq('store_id', storeId).order('sort_order'),
    supabase.from('cast_profile_fields').select('*').eq('store_id', storeId).order('sort_order'),
  ])

  return (
    <div className="p-6 space-y-6">
      <StoreSettings store={store} settings={settings} storeId={storeId} />
      <ShiftChecklistSettings items={checklistItems ?? []} storeId={storeId} />
      <CastProfileFieldsSettings fields={profileFields ?? []} storeId={storeId} />
    </div>
  )
}
