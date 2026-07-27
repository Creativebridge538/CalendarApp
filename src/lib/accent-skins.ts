export type AccentSkin = {
  id: string
  label: string
  accent: string
  accent2: string
  dark: string
  bg: string
  /** trueの場合、背景・カード・文字色なども合わせてダーク配色にする（画面全体をダークモード化） */
  isDark?: boolean
}

export const ACCENT_SKINS: AccentSkin[] = [
  { id: 'blue',   label: 'ブルー',   accent: '#3987e5', accent2: '#5b9ee8', dark: '#2f6fc4', bg: '#f7f7f8' },
  { id: 'pink',   label: 'ピンク',   accent: '#d81b60', accent2: '#f0428a', dark: '#b3105a', bg: '#f5eef1' },
  { id: 'purple', label: 'パープル', accent: '#7c3aed', accent2: '#a378f2', dark: '#5b21b6', bg: '#f3eefd' },
  { id: 'green',  label: 'グリーン', accent: '#0ca678', accent2: '#34c99a', dark: '#087f5b', bg: '#eaf9f3' },
  { id: 'orange', label: 'オレンジ', accent: '#e8590c', accent2: '#f2793d', dark: '#b8450a', bg: '#fdf1e9' },
  { id: 'black',  label: 'ブラック', accent: '#d4a537', accent2: '#e8c766', dark: '#a3791f', bg: '#141414', isDark: true },
]

export const DEFAULT_ACCENT_SKIN = 'blue'

export function getAccentSkin(id?: string | null): AccentSkin {
  return ACCENT_SKINS.find(s => s.id === id) ?? ACCENT_SKINS.find(s => s.id === DEFAULT_ACCENT_SKIN)!
}
