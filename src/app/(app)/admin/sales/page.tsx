import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, endOfMonth } from 'date-fns'
import { SalesInput } from '@/components/sales/sales-input'
import { nowJST } from '@/lib/jst'

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
  const now = nowJST()
  const { year: yearParam, month: monthParam } = await searchParams
  const year = parseInt(yearParam ?? '') || now.getFullYear()
  const month = parseInt(monthParam ?? '') || now.getMonth() + 1

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = format(endOfMonth(new Date(`${monthStart}T00:00:00`)), 'yyyy-MM-dd')

  const [{ data: casts }, { data: sales }, { data: settings }, { data: stageNameRows }, { data: itemTemplates }, { data: includedInSalesTemplates }] = await Promise.all([
    supabase.from('users').select('id, display_name, reward_rate, platform_reward_rates, daily_payment_reward_rate, platform_daily_payment_reward_rates').eq('store_id', storeId).eq('role', 'cast').eq('is_active', true).order('display_name'),
    supabase.from('sales').select('*, cast:users!sales_cast_id_fkey(display_name)').eq('store_id', storeId)
      .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: false }),
    supabase.from('store_settings').select('usd_jpy_rate, usd_jpy_auto_fetch, usd_jpy_adjustment, platform_settings, enabled_platforms, notice_item_config').eq('store_id', storeId).single(),
    supabase.from('cast_stage_names').select('cast_id, name').eq('store_id', storeId),
    supabase.from('notice_item_templates').select('id, label, unit, include_in_sales').eq('store_id', storeId).eq('is_active', true).order('sort_order'),
    // 売上合計への反映判定は「無効」にした項目の過去データも対象にする必要があるため、is_activeで絞らない
    // （他画面（支払通知書・ダッシュボード）と同じ集計にするため。ここをitemTemplatesと同じ絞り込みにすると、
    // 項目を無効化した瞬間に売上一覧の合計だけ他画面と食い違ってしまう）
    supabase.from('notice_item_templates').select('label').eq('store_id', storeId).eq('include_in_sales', true),
  ])

  const stageNamesByCastId: Record<string, string[]> = {}
  for (const row of stageNameRows ?? []) {
    stageNamesByCastId[row.cast_id] ??= []
    stageNamesByCastId[row.cast_id].push(row.name)
  }

  return (
    <div className="p-6">
      <SalesInput
        key={`${year}-${month}`}
        casts={casts ?? []} sales={sales ?? []} storeId={storeId} userId={user.id} storeSettings={settings}
        year={year} month={month} stageNamesByCastId={stageNamesByCastId}
        itemTemplates={itemTemplates ?? []}
        includedInSalesLabels={(includedInSalesTemplates ?? []).map(t => t.label)}
      />
    </div>
  )
}
