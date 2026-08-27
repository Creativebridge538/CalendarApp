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
 * 報酬率の優先順位: 日払い時の個別上書き ＞ プラットフォーム別報酬率 ＞ 基本報酬率
 */
export function effectiveRewardRate(
  sale: RewardRateSale,
  castRewardRate: number,
  platformRewardRates?: PlatformRewardRates | null
): number {
  if (sale.is_daily_payment && sale.reward_rate_override != null) {
    return Number(sale.reward_rate_override)
  }
  const platformRate = platformRewardRates?.[sale.platform as PlatformKey | 'manual']
  return platformRate ?? castRewardRate
}
