import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, endOfMonth } from 'date-fns'
import { SalesInput } from '@/components/sales/sales-input'

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const now = new Date()
  const { year: yearParam, month: monthParam } = await searchParams
  const year = parseInt(yearParam ?? '') || now.getFullYear()
  const month = parseInt(monthParam ?? '') || now.getMonth() + 1

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = format(endOfMonth(new Date(`${monthStart}T00:00:00`)), 'yyyy-MM-dd')

  const [{ data: casts }, { data: sales }, { data: settings }, { data: shifts }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true).order('display_name'),
    supabase.from('sales').select('*, cast:users!sales_cast_id_fkey(display_name)').eq('store_id', storeId)
      .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: false }),
    supabase.from('store_settings').select('usd_jpy_rate, platform_settings').eq('store_id', storeId).single(),
    supabase.from('shifts').select('id, cast_id, date, start_time, end_time, rooms(name)').eq('store_id', storeId)
      .gte('date', monthStart).lte('date', monthEnd),
  ])

  return (
    <div className="p-6">
      <SalesInput
        key={`${year}-${month}`}
        casts={casts ?? []} sales={sales ?? []} storeId={storeId} userId={user.id} storeSettings={settings}
        shifts={shifts ?? []}
        year={year} month={month}
      />
    </div>
  )
}
