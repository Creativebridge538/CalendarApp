import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SalesInput } from '@/components/sales/sales-input'

export default async function SalesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: casts }, { data: sales }] = await Promise.all([
    supabase.from('users').select('id, display_name').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true).order('display_name'),
    supabase.from('sales').select('*, cast:users!sales_cast_id_fkey(display_name)').eq('store_id', storeId).order('date', { ascending: false }).limit(100),
  ])

  return (
    <div className="p-6">
      <SalesInput casts={casts ?? []} sales={sales ?? []} storeId={storeId} userId={user.id} />
    </div>
  )
}
