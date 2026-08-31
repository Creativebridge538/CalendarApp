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

export interface SaleCustomItem {
  label: string
  /** 女子給ベースの金額（報酬率を掛けた後の金額。円以外の単位はここに報酬率が反映済み） */
  amount: number
  unit?: string
  rawUnits?: string
  /** 売上（店舗の粗売上）ベースの金額（報酬率を掛けていない、プラットフォーム換算後の金額）。円単位ならamountと同額 */
  salesAmount?: number
}

// 売上行に追加した項目（ボーナス・控除と同様に加減算される、名前付きの追加金額）の合計を求める
export function customItemsTotal(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return raw.reduce((sum: number, item) => {
    const amount = Number((item as { amount?: unknown })?.amount)
    return sum + (Number.isNaN(amount) ? 0 : amount)
  }, 0)
}

// 売上行のcustom_itemsを検証済みの配列として取り出す（支払通知書への内訳表示・売上反映判定用）
export function parseCustomItems(raw: unknown): SaleCustomItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    const label = (item as { label?: unknown })?.label
    const amount = Number((item as { amount?: unknown })?.amount)
    if (typeof label !== 'string' || !label.trim() || Number.isNaN(amount)) return []
    const unit = (item as { unit?: unknown })?.unit
    const rawUnits = (item as { rawUnits?: unknown })?.rawUnits
    const salesAmountRaw = (item as { salesAmount?: unknown })?.salesAmount
    const salesAmount = Number(salesAmountRaw)
    return [{
      label: label.trim(), amount,
      unit: typeof unit === 'string' ? unit : undefined,
      rawUnits: typeof rawUnits === 'string' ? rawUnits : undefined,
      salesAmount: Number.isNaN(salesAmount) ? undefined : salesAmount,
    }]
  })
}

// 「売上に反映する」設定がオンのテンプレートに一致する項目だけ、売上ベースの金額を合計する
// （店舗の粗売上に含めるかどうかは項目テンプレート側の設定で決まる。円以外の単位は報酬率を掛ける前の金額を使う）
export function includedInSalesTotal(raw: unknown, includedLabels: ReadonlySet<string>): number {
  return parseCustomItems(raw)
    .filter(item => includedLabels.has(item.label))
    .reduce((sum, item) => sum + (item.salesAmount ?? item.amount), 0)
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
