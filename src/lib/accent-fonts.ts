export type AccentFont = {
  id: string
  label: string
  /** 未指定はアプリ標準フォント（Geist + システムゴシック）を表す */
  font?: string
}

export const ACCENT_FONTS: AccentFont[] = [
  { id: 'default', label: 'デフォルト' },
  { id: 'noto', label: '角ゴシック', font: 'var(--font-noto-sans-jp), -apple-system, "Hiragino Sans", sans-serif' },
  { id: 'zen', label: 'まる太め', font: 'var(--font-zen-maru-gothic), "Hiragino Maru Gothic ProN", sans-serif' },
  { id: 'mplus', label: 'まる細め', font: 'var(--font-mplus-rounded), "Hiragino Maru Gothic ProN", sans-serif' },
  { id: 'kosugi', label: 'すっきり丸', font: 'var(--font-kosugi-maru), "Hiragino Maru Gothic ProN", sans-serif' },
  { id: 'mochiy', label: 'ポップ', font: 'var(--font-mochiy-pop-one), "Hiragino Maru Gothic ProN", sans-serif' },
  { id: 'kiwi', label: 'ふんわり', font: 'var(--font-kiwi-maru), "Hiragino Maru Gothic ProN", sans-serif' },
  { id: 'hachimaru', label: 'ぽこぽこ', font: 'var(--font-hachi-maru-pop), "Hiragino Maru Gothic ProN", sans-serif' },
]

export const DEFAULT_ACCENT_FONT = 'default'

export function getAccentFont(id?: string | null): AccentFont {
  return ACCENT_FONTS.find(f => f.id === id) ?? ACCENT_FONTS.find(f => f.id === DEFAULT_ACCENT_FONT)!
}
