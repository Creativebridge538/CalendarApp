import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { shiftHours } from '@/lib/shift-hours'
import { effectiveRewardRate, parsePlatformRewardRates, customItemsTotal } from '@/lib/reward-rate'
import { nowJST } from '@/lib/jst'

export interface MonthToDateSummary {
  monthLabel: string
  thisMonthTotal: number
  prevMonthToDateTotal: number
  monthlyGoal: number | null
  attendanceDaysThisMonth: number
  shiftCountThisMonth: number
  totalHoursThisMonth: number
}

interface CastRewardProfile {
  reward_rate: number | string
  platform_reward_rates: unknown
  daily_payment_reward_rate: number | string | null
  platform_daily_payment_reward_rates: unknown
}

/** シフト画面の「小さい収益サマリー」用。収益ダッシュボードの本体計算とは独立して、必要最小限だけ取得する。
 * 表記は「売上」のままだが、キャストが実際に受け取る女子給ベースの金額を表示する */
export async function getMonthToDateSummary(
  supabase: SupabaseClient<Database>,
  castId: string,
  castProfile: CastRewardProfile
): Promise<MonthToDateSummary> {
  const now = nowJST()
  const today = format(now, 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevMonthDate = subDays(startOfMonth(now), 1)
  const prevMonthStart = format(startOfMonth(prevMonthDate), 'yyyy-MM-dd')
  const prevMonthEnd = format(endOfMonth(prevMonthDate), 'yyyy-MM-dd')
  // 「先月の同じ日まで」との比較用に、先月分も当月と同じ日数分で切り詰める
  const prevMonthCutoffDay = Math.min(now.getDate(), Number(prevMonthEnd.slice(-2)))
  const prevMonthCutoff = format(new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), prevMonthCutoffDay), 'yyyy-MM-dd')

  const [{ data: sales }, { data: profile }, { data: shifts }] = await Promise.all([
    supabase.from('sales').select('date, amount, platform, is_daily_payment, reward_rate_override, bonus, deduction, custom_items')
      .eq('cast_id', castId).gte('date', prevMonthStart).lte('date', today),
    supabase.from('users').select('monthly_goal').eq('id', castId).single(),
    supabase.from('shifts').select('date, start_time, end_time').eq('cast_id', castId).gte('date', monthStart).lte('date', monthEnd),
  ])

  const rewardRate = Number(castProfile.reward_rate)
  const platformRates = parsePlatformRewardRates(castProfile.platform_reward_rates)
  const platformDailyRates = parsePlatformRewardRates(castProfile.platform_daily_payment_reward_rates)
  function rewardOf(s: { amount: number | string; platform: string; is_daily_payment: boolean; reward_rate_override: number | string | null; bonus: number | string; deduction: number | string; custom_items: unknown }): number {
    const rate = effectiveRewardRate(s, rewardRate, platformRates, castProfile.daily_payment_reward_rate, platformDailyRates)
    const baseReward = Math.floor(Number(s.amount) * rate)
    return baseReward + Number(s.bonus) - Number(s.deduction) + customItemsTotal(s.custom_items)
  }

  const salesList = sales ?? []
  const thisMonthTotal = salesList
    .filter(s => s.date >= monthStart && s.date <= monthEnd)
    .reduce((sum, s) => sum + rewardOf(s), 0)
  const prevMonthToDateTotal = salesList
    .filter(s => s.date >= prevMonthStart && s.date <= prevMonthCutoff)
    .reduce((sum, s) => sum + rewardOf(s), 0)

  const shiftsList = shifts ?? []

  return {
    monthLabel: `${now.getMonth() + 1}月`,
    thisMonthTotal,
    prevMonthToDateTotal,
    monthlyGoal: profile?.monthly_goal != null ? Number(profile.monthly_goal) : null,
    attendanceDaysThisMonth: new Set(shiftsList.map(s => s.date)).size,
    shiftCountThisMonth: shiftsList.length,
    totalHoursThisMonth: shiftsList.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0),
  }
}
