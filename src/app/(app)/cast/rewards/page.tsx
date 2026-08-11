import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { CastRewardDashboard } from '@/components/rewards/cast-reward-dashboard'
import { shiftHours } from '@/lib/shift-hours'

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

export default async function CastRewardsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const sixtyDaysAgo = format(subDays(now, 59), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevMonthDate = subDays(startOfMonth(now), 1)
  const prevMonthStart = format(startOfMonth(prevMonthDate), 'yyyy-MM-dd')
  const prevMonthEnd = format(endOfMonth(prevMonthDate), 'yyyy-MM-dd')

  const [{ data: sales }, { data: shifts }, { data: reward }, { data: settings }, { data: checklistItems }] =
    await Promise.all([
      supabase.from('sales').select('date, amount, platform, is_daily_payment')
        .eq('cast_id', user.id).gte('date', sixtyDaysAgo).lte('date', today).order('date'),
      supabase.from('shifts').select('date, start_time, end_time, admin_note, checklist_answers, status')
        .eq('cast_id', user.id).gte('date', monthStart).lte('date', monthEnd),
      supabase.from('reward_calculations').select('total_reward, is_finalized')
        .eq('cast_id', user.id).eq('period_year', now.getFullYear()).eq('period_month', now.getMonth() + 1).maybeSingle(),
      supabase.from('store_settings').select('usd_jpy_rate').eq('store_id', profile.store_id).maybeSingle(),
      supabase.from('shift_checklist_items').select('id, label, item_type').eq('store_id', profile.store_id),
    ])

  const salesList = sales ?? []
  const shiftsList = shifts ?? []

  // 日付ごとの売上合計（当月カレンダー用）
  const salesByDate = new Map<string, { total: number; rows: { platform: string; amount: number; is_daily_payment: boolean }[] }>()
  for (const s of salesList) {
    const entry = salesByDate.get(s.date) ?? { total: 0, rows: [] }
    entry.total += Number(s.amount)
    entry.rows.push({ platform: s.platform, amount: Number(s.amount), is_daily_payment: s.is_daily_payment })
    salesByDate.set(s.date, entry)
  }

  const shiftsByDate = new Map(shiftsList.map(s => [s.date, s]))

  // 日付ごとの勤務時間合計（同日に複数シフトがある場合は合算）
  const hoursByDate = new Map<string, number>()
  for (const s of shiftsList) {
    hoursByDate.set(s.date, (hoursByDate.get(s.date) ?? 0) + shiftHours(s.start_time, s.end_time))
  }

  // 当月カレンダーグリッド（日曜始まり、前後の月の空白セルも含む）
  const monthStartDate = startOfMonth(now)
  const monthEndDate = endOfMonth(now)
  const leadingBlanks = monthStartDate.getDay()
  const daysInMonth = monthEndDate.getDate()
  const calendarDays: { date: string | null; day: number | null; amount: number; hours: number; isToday: boolean }[] = []
  for (let i = 0; i < leadingBlanks; i++) calendarDays.push({ date: null, day: null, amount: 0, hours: 0, isToday: false })
  for (let d = 1; d <= daysInMonth; d++) {
    const date = format(new Date(now.getFullYear(), now.getMonth(), d), 'yyyy-MM-dd')
    calendarDays.push({
      date, day: d,
      amount: salesByDate.get(date)?.total ?? 0,
      hours: hoursByDate.get(date) ?? 0,
      isToday: date === today,
    })
  }

  const thisMonthTotal = [...salesByDate.entries()]
    .filter(([date]) => date >= monthStart && date <= monthEnd)
    .reduce((sum, [, v]) => sum + v.total, 0)
  // 「先月の同じ日まで」との比較用に、先月分も当月と同じ日数分で切り詰めて合計する
  const prevMonthCutoffDay = Math.min(now.getDate(), Number(prevMonthEnd.slice(-2)))
  const prevMonthCutoff = format(new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), prevMonthCutoffDay), 'yyyy-MM-dd')
  const prevMonthToDateTotal = salesList
    .filter(s => s.date >= prevMonthStart && s.date <= prevMonthCutoff)
    .reduce((sum, s) => sum + Number(s.amount), 0)

  const workedDaysThisMonth = [...salesByDate.keys()].filter(d => d >= monthStart && d <= monthEnd).length
  const avgPerWorkedDay = workedDaysThisMonth > 0 ? Math.round(thisMonthTotal / workedDaysThisMonth) : 0

  // 出勤日数・時間は「実際に出勤し終えたもの」だけを対象にする（未来日・未確定のシフトは予定でしかないため除外）
  const attendedShiftsThisMonth = shiftsList.filter(s => s.date <= today && s.status === 'confirmed')
  const attendanceDaysThisMonth = new Set(attendedShiftsThisMonth.map(s => s.date)).size
  const totalHoursThisMonth = attendedShiftsThisMonth.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0)

  // 今月のプラットフォーム別内訳
  const platformBreakdownMap = new Map<string, number>()
  for (const [date, v] of salesByDate.entries()) {
    if (date < monthStart || date > monthEnd) continue
    for (const row of v.rows) {
      platformBreakdownMap.set(row.platform, (platformBreakdownMap.get(row.platform) ?? 0) + row.amount)
    }
  }
  const platformBreakdown = [...platformBreakdownMap.entries()]
    .map(([platform, amount]) => ({ platform, amount }))
    .sort((a, b) => b.amount - a.amount)

  // 直近30日の推移
  const trend = Array.from({ length: 30 }, (_, idx) => {
    const i = 29 - idx
    const d = format(subDays(now, i), 'yyyy-MM-dd')
    return { date: d, amount: salesByDate.get(d)?.total ?? 0 }
  })

  // 曜日別平均（直近60日）
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
  const weekdaySums = new Array(7).fill(0)
  const weekdayCounts = new Array(7).fill(0)
  for (const [date, v] of salesByDate.entries()) {
    const dow = parseLocalDate(date).getDay()
    weekdaySums[dow] += v.total
    weekdayCounts[dow] += 1
  }
  const weekday = weekdayLabels.map((label, i) => ({
    label,
    amount: weekdayCounts[i] > 0 ? Math.round(weekdaySums[i] / weekdayCounts[i]) : 0,
  }))

  // 日別詳細（当月分のみ、クリック時にクライアント側で参照）
  const dayDetails: Record<string, {
    total: number
    rows: { platform: string; amount: number; is_daily_payment: boolean }[]
    shift: { start_time: string; end_time: string; admin_note: string | null; checklistLabels: string[] } | null
  }> = {}
  const checklistMap = new Map((checklistItems ?? []).map(c => [c.id, c]))
  for (const [date, v] of salesByDate.entries()) {
    if (date < monthStart || date > monthEnd) continue
    const shift = shiftsByDate.get(date)
    const checklistLabels = shift
      ? Object.entries((shift.checklist_answers ?? {}) as Record<string, boolean | string>)
          .map(([id, value]) => {
            const item = checklistMap.get(id)
            if (!item || !value) return null
            return item.item_type === 'select' ? `${item.label}: ${value}` : item.label
          })
          .filter((v): v is string => !!v)
      : []
    dayDetails[date] = {
      total: v.total,
      rows: v.rows,
      shift: shift ? { start_time: shift.start_time, end_time: shift.end_time, admin_note: shift.admin_note, checklistLabels } : null,
    }
  }
  // 売上がなくシフトのみある日（お休みでない出勤日など）もシフト情報だけ見られるように補完
  for (const [date, shift] of shiftsByDate.entries()) {
    if (date < monthStart || date > monthEnd) continue
    if (dayDetails[date]) continue
    const checklistLabels = Object.entries((shift.checklist_answers ?? {}) as Record<string, boolean | string>)
      .map(([id, value]) => {
        const item = checklistMap.get(id)
        if (!item || !value) return null
        return item.item_type === 'select' ? `${item.label}: ${value}` : item.label
      })
      .filter((v): v is string => !!v)
    dayDetails[date] = {
      total: 0,
      rows: [],
      shift: { start_time: shift.start_time, end_time: shift.end_time, admin_note: shift.admin_note, checklistLabels },
    }
  }

  return (
    <div className="px-4 py-4 md:p-6 max-w-lg mx-auto">
      <CastRewardDashboard
        userId={user.id}
        displayName={profile.display_name}
        monthLabel={`${now.getFullYear()}年${now.getMonth() + 1}月`}
        year={now.getFullYear()}
        month={now.getMonth() + 1}
        thisMonthTotal={thisMonthTotal}
        prevMonthToDateTotal={prevMonthToDateTotal}
        monthlyGoal={profile.monthly_goal != null ? Number(profile.monthly_goal) : null}
        calendarDays={calendarDays}
        avgPerWorkedDay={avgPerWorkedDay}
        attendanceDaysThisMonth={attendanceDaysThisMonth}
        totalHoursThisMonth={totalHoursThisMonth}
        platformBreakdown={platformBreakdown}
        trend={trend}
        weekday={weekday}
        dayDetails={dayDetails}
        usdJpyRate={settings?.usd_jpy_rate ?? null}
        finalizedReward={reward?.is_finalized ? Number(reward.total_reward) : null}
      />
    </div>
  )
}
