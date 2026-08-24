import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, endOfMonth } from 'date-fns'
import { SalesInput } from '@/components/sales/sales-input'

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = new Date()
  const { year: yearParam, month: monthParam } = await searchParams
  const year = parseInt(yearParam ?? '') || now.getFullYear()
  const month = parseInt(monthParam ?? '') || now.getMonth() + 1

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = format(endOfMonth(new Date(`${monthStart}T00:00:00`)), 'yyyy-MM-dd')

  const [{ data: casts }, { data: sales }, { data: settings }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true).order('display_name'),
    supabase.from('sales').select('*, cast:users!sales_cast_id_fkey(display_name)').eq('store_id', storeId)
      .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: false }),
    supabase.from('store_settings').select('usd_jpy_rate, usd_jpy_auto_fetch, usd_jpy_adjustment, platform_settings').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <SalesInput
        key={`${year}-${month}`}
        casts={casts ?? []} sales={sales ?? []} storeId={storeId} userId={user.id} storeSettings={settings}
        year={year} month={month}
      />
    </div>
  )
}
