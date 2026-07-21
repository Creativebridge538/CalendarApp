export type PlatformKey = 'stripchat' | 'fc2' | 'dxlive'
export type PlatformMode = 'formula' | 'fixed'
export type PlatformConfig = {
  mode: PlatformMode
  fixed_rate: number | null
  /** 計算式モードの掛け率上書き。nullなら DEFAULT_FORMULA_MULTIPLIER を使う */
  formula_multiplier: number | null
}
export type PlatformSettings = Record<PlatformKey, PlatformConfig>

/**
 * 各プラットフォームの標準的な換算式における掛け率。
 * STRIPCHAT: TK ÷ 10 ÷ 2 = TK × (1/20) ドル
 * DXライブ: ポイント × 2ドル × 0.3 = ポイント × 0.6 ドル
 * FC2: ポイント × 1 = 円（そのまま）
 */
export const DEFAULT_FORMULA_MULTIPLIER: Record<PlatformKey, number> = {
  stripchat: 1 / 20,
  fc2: 1,
  dxlive: 0.6,
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  stripchat: { mode: 'formula', fixed_rate: null, formula_multiplier: null },
  fc2: { mode: 'formula', fixed_rate: null, formula_multiplier: null },
  dxlive: { mode: 'formula', fixed_rate: null, formula_multiplier: null },
}

export function parsePlatformSettings(raw: unknown): PlatformSettings {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<PlatformKey, Partial<PlatformConfig>>>
  const result = { ...DEFAULT_PLATFORM_SETTINGS }
  for (const key of Object.keys(DEFAULT_PLATFORM_SETTINGS) as PlatformKey[]) {
    result[key] = { ...DEFAULT_PLATFORM_SETTINGS[key], ...parsed[key] }
  }
  return result
}

export interface PlatformCalcResult {
  jpy: number
  usd: number | null
}

/**
 * rateOverride は日払い時の「1単位＝◯円」上書き。指定があれば計算式・固定単価より優先される。
 */
export function calcPlatformAmount(
  platform: PlatformKey,
  rawUnits: number,
  config: PlatformConfig | undefined,
  usdJpyRate: number | null,
  rateOverride: number | null
): PlatformCalcResult {
  if (rateOverride != null && !Number.isNaN(rateOverride)) {
    return { jpy: Math.round(rawUnits * rateOverride), usd: null }
  }

  const mode = config?.mode ?? 'formula'
  if (mode === 'fixed' && config?.fixed_rate != null) {
    return { jpy: Math.round(rawUnits * config.fixed_rate), usd: null }
  }

  const multiplier = config?.formula_multiplier ?? DEFAULT_FORMULA_MULTIPLIER[platform]

  if (platform === 'fc2') {
    return { jpy: Math.round(rawUnits * multiplier), usd: null }
  }

  const usd = rawUnits * multiplier
  const rate = usdJpyRate ?? 0
  return { jpy: Math.round(usd * rate), usd }
}
