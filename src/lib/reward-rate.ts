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

export interface SaleCustomItem { label: string; amount: number }

// 売上行に追加した項目（ボーナス・控除と同様に加減算される、名前付きの追加金額）の合計を求める
export function customItemsTotal(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return raw.reduce((sum: number, item) => {
    const amount = Number((item as { amount?: unknown })?.amount)
    return sum + (Number.isNaN(amount) ? 0 : amount)
  }, 0)
}

interface RewardRateSale {
  platform: string
  is_daily_payment: boolean
  reward_rate_override: number | string | null
}

/**
 * 報酬率の優先順位:
 * 日払い時: 個別上書き ＞ プラットフォーム別の前払い率 ＞ キャスト共通の前払い率 ＞ プラットフォーム別報酬率 ＞ 基本報酬率
 * 通常時: プラットフォーム別報酬率 ＞ 基本報酬率
 */
export function effectiveRewardRate(
  sale: RewardRateSale,
  castRewardRate: number,
  platformRewardRates?: PlatformRewardRates | null,
  castDailyPaymentRate?: number | string | null,
  platformDailyPaymentRewardRates?: PlatformRewardRates | null
): number {
  const platformRate = platformRewardRates?.[sale.platform as PlatformKey | 'manual']
  if (sale.is_daily_payment) {
    if (sale.reward_rate_override != null) return Number(sale.reward_rate_override)
    const platformDailyRate = platformDailyPaymentRewardRates?.[sale.platform as PlatformKey | 'manual']
    if (platformDailyRate != null) return platformDailyRate
    if (castDailyPaymentRate != null) return Number(castDailyPaymentRate)
  }
  return platformRate ?? castRewardRate
}
