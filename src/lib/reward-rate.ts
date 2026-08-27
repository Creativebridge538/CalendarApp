import type { PlatformKey } from './platform-earnings'

export type PlatformRewardRates = Partial<Record<PlatformKey | 'manual', number>>

export function parsePlatformRewardRates(raw: unknown): PlatformRewardRates {
  if (!raw || typeof raw !== 'object') return {}
  const result: PlatformRewardRates = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(value)
    if (!Number.isNaN(num)) result[key as PlatformKey | 'manual'] = num
  }
  return result
}

interface RewardRateSale {
  platform: string
  is_daily_payment: boolean
  reward_rate_override: number | string | null
}

/**
 * 報酬率の優先順位: 日払い時の個別上書き ＞ 日払い時のデフォルト報酬率 ＞ プラットフォーム別報酬率 ＞ 基本報酬率
 * （日払い時のデフォルト・個別上書きは、日払い（is_daily_payment）の売上にのみ適用される）
 */
export function effectiveRewardRate(
  sale: RewardRateSale,
  castRewardRate: number,
  platformRewardRates?: PlatformRewardRates | null,
  castDailyPaymentRate?: number | string | null
): number {
  if (sale.is_daily_payment) {
    if (sale.reward_rate_override != null) return Number(sale.reward_rate_override)
    if (castDailyPaymentRate != null) return Number(castDailyPaymentRate)
  }
  const platformRate = platformRewardRates?.[sale.platform as PlatformKey | 'manual']
  return platformRate ?? castRewardRate
}
