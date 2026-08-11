import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, subDays, subMonths, startOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { AdminAnalytics } from '@/components/dashboard/admin-analytics'

export default async function DashboardPage() {
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (profile?.role === 'admin') {
    return <AdminDashboard storeId={profile.store_id!} />
  }

  // キャストはダッシュボードを経由せず、シフト提出画面を直接使う
  redirect('/cast/shifts')
}

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

async function AdminDashboard({ storeId }: { storeId: string }) {
  const supabase = await createClient()
  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const sixtyDaysAgo = format(subDays(now, 59), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const prevMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')

  const [{ count: pendingShifts }, { count: pendingRequests }, { count: pendingVacantApplications }, { data: todayShifts }, { data: sales }, { data: casts }] =
    await Promise.all([
      supabase.from('shifts').select('*', { count: 'exact', head: true })
        .eq('store_id', storeId).eq('status', 'submitted'),
      supabase.from('shift_modification_requests').select('shifts!inner(store_id)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('shifts.store_id', storeId),
      supabase.from('vacant_slot_applications').select('vacant_slots!inner(store_id)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('vacant_slots.store_id', storeId),
      supabase.from('shifts')
        .select('*, cast:users!shifts_cast_id_fkey(display_name), rooms(name)')
        .eq('store_id', storeId)
        .eq('date', today)
        .eq('status', 'confirmed')
        .order('start_time'),
      supabase.from('sales').select('date, amount, cast_id')
        .eq('store_id', storeId).gte('date', sixtyDaysAgo).lte('date', today),
      supabase.from('users').select('id, display_name')
        .eq('store_id', storeId).eq('role', 'cast'),
    ])

  const salesList = sales ?? []
  const castNameMap = new Map((casts ?? []).map(c => [c.id, c.display_name ?? '—']))

  // 直近30日の日次売上推移
  const trend = Array.from({ length: 30 }, (_, idx) => {
    const i = 29 - idx
    const d = format(subDays(now, i), 'yyyy-MM-dd')
    const amount = salesList.filter(s => s.date === d).reduce((sum, s) => sum + Number(s.amount), 0)
    return { date: d, amount }
  })

  // 今月・先月の合計
  const thisMonthSales = salesList.filter(s => s.date >= monthStart)
  const prevMonthSales = salesList.filter(s => s.date >= prevMonthStart && s.date < monthStart)
  const totalThisMonth = thisMonthSales.reduce((sum, s) => sum + Number(s.amount), 0)
  const totalPrevMonth = prevMonthSales.reduce((sum, s) => sum + Number(s.amount), 0)

  // キャスト別ランキング（今月）
  const castTotals = new Map<string, number>()
  thisMonthSales.forEach(s => castTotals.set(s.cast_id, (castTotals.get(s.cast_id) ?? 0) + Number(s.amount)))
  const castRanking = [...castTotals.entries()]
    .map(([castId, amount]) => ({ name: castNameMap.get(castId) ?? '—', amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  // 曜日別平均売上（直近60日）
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
  const weekdaySums = new Array(7).fill(0)
  const weekdayCounts = new Array(7).fill(0)
  salesList.forEach(s => {
    const dow = parseLocalDate(s.date).getDay()
    weekdaySums[dow] += Number(s.amount)
    weekdayCounts[dow] += 1
  })
  const weekday = weekdayLabels.map((label, i) => ({
    label,
    amount: weekdayCounts[i] > 0 ? Math.round(weekdaySums[i] / weekdayCounts[i]) : 0,
  }))

  // 追加KPI: 稼働キャスト数・平均日商（今月）
  const activeCastCount = new Set(thisMonthSales.map(s => s.cast_id)).size
  const daysElapsedThisMonth = now.getDate()
  const avgDailySales = daysElapsedThisMonth > 0 ? Math.round(totalThisMonth / daysElapsedThisMonth) : 0

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
