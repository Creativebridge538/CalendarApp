const MINUTE_OPTIONS = ['00', '15', '30', '45']

/** TimeSelectで選べる最大の時（深夜営業の「25:00」表記まで入力できる既存画面用のデフォルト） */
export const DEFAULT_MAX_HOUR = 29

/**
 * "HH:MM" の選択肢を、00:00〜{maxHour}:45まで15分刻みで返す。
 * 「19」を選んで「15」を選んで…と2段階にせず、"19:15" を1回で選べるようにするため時分を結合している。
 * maxHourは0〜DEFAULT_MAX_HOURの整数に丸める（範囲外・非整数・NaNでもDBに送れない値を作らない）。
 */
export function buildTimeOptions(maxHour: number = DEFAULT_MAX_HOUR): string[] {
  const limit = Number.isFinite(maxHour) ? Math.min(DEFAULT_MAX_HOUR, Math.max(0, Math.floor(maxHour))) : DEFAULT_MAX_HOUR
  return Array.from({ length: limit + 1 }, (_, i) => String(i).padStart(2, '0'))
    .flatMap(h => MINUTE_OPTIONS.map(m => `${h}:${m}`))
}
