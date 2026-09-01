import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, subMonths, addMonths, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns'
import { ja } from 'date-fns/locale'
import { AdminAnalytics } from '@/components/dashboard/admin-analytics'
import { includedInSalesTotal } from '@/lib/reward-rate'
import { nowJST } from '@/lib/jst'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (profile?.role === 'admin') {
    const { year: yearParam, month: monthParam } = await searchParams
    return <AdminDashboard storeId={profile.store_id!} yearParam={yearParam} monthParam={monthParam} />
  }

  // キャストはダッシュボードを経由せず、シフト提出画面を直接使う
  redirect('/cast/shifts')
}

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

async function AdminDashboard({ storeId, yearParam, monthParam }: { storeId: string; yearParam?: string; monthParam?: string }) {
  const supabase = await createClient()
  const now = nowJST()
  const today = format(now, 'yyyy-MM-dd')

  const year = parseInt(yearParam ?? '') || now.getFullYear()
  const month = parseInt(monthParam ?? '') || now.getMonth() + 1
  const targetMonthDate = new Date(year, month - 1, 1)
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  const monthStart = format(startOfMonth(targetMonthDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(targetMonthDate), 'yyyy-MM-dd')
  const prevMonthDate = subMonths(targetMonthDate, 1)
  const prevMonthStart = format(startOfMonth(prevMonthDate), 'yyyy-MM-dd')
  const nextMonthDate = addMonths(targetMonthDate, 1)

  const [{ count: pendingShifts }, { count: pendingRequests }, { count: pendingVacantApplications }, { data: todayShifts }, { data: sales }, { data: casts }, { data: includedInSalesTemplates }] =
    await Promise.all([
      supabase.from('shifts').select('*', { count: 'exact', head: true })
        .eq('store_id', storeId).eq('status', 'submitted'),
      supabase.from('shift_modification_requests').select('shifts!inner(store_id)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('shifts.store_id', storeId),
      // 日付が過ぎた空き枠への申請は、管理画面の一覧からも消えて対応しようがないため件数に含めない
      supabase.from('vacant_slot_applications').select('vacant_slots!inner(store_id, date)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('vacant_slots.store_id', storeId)
        .gte('vacant_slots.date', today),
      supabase.from('shifts')
        .select('*, cast:users!shifts_cast_id_fkey(display_name), rooms(name)')
        .eq('store_id', storeId)
        .eq('date', today)
        .eq('status', 'confirmed')
        .order('start_time'),
      // 表示対象月と、先月比の算出に必要な前月分をまとめて取得する
      supabase.from('sales').select('date, amount, sales_amount, cast_id, custom_items')
        .eq('store_id', storeId).gte('date', prevMonthStart).lte('date', monthEnd),
      supabase.from('users').select('id, display_name')
        .eq('store_id', storeId).eq('role', 'cast'),
      supabase.from('notice_item_templates').select('label').eq('store_id', storeId).eq('include_in_sales', true),
    ])

  const salesList = sales ?? []
  const castNameMap = new Map((casts ?? []).map(c => [c.id, c.display_name ?? '—']))
  // 「売上に反映する」設定がオンのテンプレート項目は、その分も売上合計に加算する
  const includedInSalesLabels = new Set((includedInSalesTemplates ?? []).map(t => t.label))
  // 固定単価モードでも常に計算式モードの換算結果（sales_amount）を売上として使う
  function salesAmountOf(s: { amount: number | string; sales_amount: number | string | null; custom_items: unknown }): number {
    return Number(s.sales_amount ?? s.amount) + includedInSalesTotal(s.custom_items, includedInSalesLabels)
  }

  // 対象月の日次売上推移（月の日数分。今月の場合は今日以降も0円のまま表示される）
  const trend = eachDayOfInterval({ start: parseLocalDate(monthStart), end: parseLocalDate(monthEnd) }).map(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    const amount = salesList.filter(s => s.date === dateStr).reduce((sum, s) => sum + salesAmountOf(s), 0)
    return { date: dateStr, amount }
  })

  // 対象月・前月の合計
  const targetMonthSales = salesList.filter(s => s.date >= monthStart && s.date <= monthEnd)
  const prevMonthSales = salesList.filter(s => s.date >= prevMonthStart && s.date < monthStart)
  const totalThisMonth = targetMonthSales.reduce((sum, s) => sum + salesAmountOf(s), 0)
  const totalPrevMonth = prevMonthSales.reduce((sum, s) => sum + salesAmountOf(s), 0)

  // キャスト別ランキング（対象月）
  const castTotals = new Map<string, number>()
  targetMonthSales.forEach(s => castTotals.set(s.cast_id, (castTotals.get(s.cast_id) ?? 0) + salesAmountOf(s)))
  const castRanking = [...castTotals.entries()]
    .map(([castId, amount]) => ({ name: castNameMap.get(castId) ?? '—', amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  // 曜日別平均売上（対象月内のみ）
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
  const weekdaySums = new Array(7).fill(0)
  const weekdayCounts = new Array(7).fill(0)
  targetMonthSales.forEach(s => {
    const dow = parseLocalDate(s.date).getDay()
    weekdaySums[dow] += salesAmountOf(s)
    weekdayCounts[dow] += 1
  })
  const weekday = weekdayLabels.map((label, i) => ({
    label,
    amount: weekdayCounts[i] > 0 ? Math.round(weekdaySums[i] / weekdayCounts[i]) : 0,
  }))

  // 追加KPI: 稼働キャスト数・平均日商（対象月）。今月分は経過日数、過去月は月の日数で割る
  const activeCastCount = new Set(targetMonthSales.map(s => s.cast_id)).size
  const daysInTargetMonth = trend.length
  const daysDivisor = isCurrentMonth ? now.getDate() : daysInTargetMonth
  const avgDailySales = daysDivisor > 0 ? Math.round(totalThisMonth / daysDivisor) : 0

  return (
    <AdminAnalytics
      pendingShifts={pendingShifts ?? 0}
      pendingRequests={pendingRequests ?? 0}
      pendingVacantApplications={pendingVacantApplications ?? 0}
      todayShifts={(todayShifts ?? []).map(s => ({
        id: s.id,
        castName: (s.cast as { display_name: string | null } | null)?.display_name ?? '—',
        startTime: s.start_time.slice(0, 5),
        endTime: s.end_time.slice(0, 5),
        roomName: (s.rooms as { name: string } | null)?.name ?? null,
      }))}
      todayLabel={format(now, 'M月d日(E)', { locale: ja })}
      monthLabel={`${year}年${month}月`}
      isCurrentMonth={isCurrentMonth}
      prevMonthHref={`/dashboard?year=${prevMonthDate.getFullYear()}&month=${prevMonthDate.getMonth() + 1}`}
      nextMonthHref={`/dashboard?year=${nextMonthDate.getFullYear()}&month=${nextMonthDate.getMonth() + 1}`}
      currentMonthHref="/dashboard"
      totalThisMonth={totalThisMonth}
      totalPrevMonth={totalPrevMonth}
      trend={trend}
      castRanking={castRanking}
      weekday={weekday}
      activeCastCount={activeCastCount}
      avgDailySales={avgDailySales}
    />
  )
}
